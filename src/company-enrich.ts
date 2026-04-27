import * as cheerio from "cheerio";
import { mapLimit, withRetries } from "./lib/async.js";
import { uniqueNonEmpty } from "./lib/text.js";
import { canonicalContactKey, domainFromUrl } from "./lib/url.js";
import { isPlaceholderEmail, scoreContactCandidate, isStrongDirectEmail, isUsableDirectEmail } from "./normalization/contact-quality.js";
import { buildPageRecord, extractContacts } from "./search/extract.js";
import { getSearchProviders } from "./search/web.js";
import type {
  CompanyRecordInput,
  ContactCandidate,
  ContactRecordInput,
  ContactKind,
  Dependencies,
  PitchTheme,
} from "./types.js";

type CompanyRow = Record<string, unknown>;

function parseJsonList(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

const GENERIC_STAGE_LABELS = new Set(["", "startup", "berlin startup list", "startup list", "watchlist"]);

function normalizedCompanyDomain(value: string): string {
  return value.toLowerCase().replace(/^www\./i, "");
}

function emailDomain(value: string): string {
  return normalizedCompanyDomain(value.split("@")[1] ?? "");
}

function sortContactsForCompany(companyDomain: string, contacts: ContactCandidate[]): ContactCandidate[] {
  return contacts
    .map((contact) => ({ contact, score: scoreContactCandidate(companyDomain, contact) }))
    .sort((left, right) => right.score - left.score)
    .map(({ contact }) => contact);
}

function dedupeContacts(contacts: ContactCandidate[]): ContactCandidate[] {
  const deduped = new Map<string, ContactCandidate>();
  for (const contact of contacts) {
    const key = contact.email || contact.linkedinUrl || `${contact.kind}:${contact.sourceUrl}`;
    if (!key) continue;
    if (contact.email && isPlaceholderEmail(contact.email)) continue;
    deduped.set(key, contact);
  }
  return [...deduped.values()];
}

function collectDiscoveredUrls(baseUrl: string, html: string): string[] {
  const $ = cheerio.load(html);
  const baseDomain = domainFromUrl(baseUrl);
  const urls = new Set<string>([
    baseUrl,
    new URL("/contact", baseUrl).toString(),
    new URL("/team", baseUrl).toString(),
    new URL("/about", baseUrl).toString(),
    new URL("/careers", baseUrl).toString(),
    new URL("/jobs", baseUrl).toString(),
    new URL("/imprint", baseUrl).toString(),
  ]);

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const text = $(element).text().trim().toLowerCase();
    if (!/(contact|team|about|career|job|join|hiring|press|imprint|legal|linkedin)/i.test(`${href} ${text}`)) return;
    try {
      const resolved = new URL(href, baseUrl).toString();
      const resolvedDomain = domainFromUrl(resolved);
      if (resolvedDomain && baseDomain && resolvedDomain !== baseDomain && !/linkedin\.com/i.test(resolved)) return;
      urls.add(resolved);
    } catch {
      // Ignore malformed links.
    }
  });

  return [...urls].slice(0, 12);
}

function alternateHomepageUrls(baseUrl: string): string[] {
  try {
    const url = new URL(baseUrl);
    const candidates = new Set<string>([url.toString()]);
    const root = new URL("/", url).toString();
    candidates.add(root);
    if (url.pathname && url.pathname !== "/") {
      candidates.add(root);
    }
    if (url.hostname.startsWith("www.")) {
      const withoutWww = new URL(url.toString());
      withoutWww.hostname = withoutWww.hostname.replace(/^www\./i, "");
      candidates.add(withoutWww.toString());
      candidates.add(new URL("/", withoutWww).toString());
    } else {
      const withWww = new URL(url.toString());
      withWww.hostname = `www.${withWww.hostname}`;
      candidates.add(withWww.toString());
      candidates.add(new URL("/", withWww).toString());
    }
    return [...candidates];
  } catch {
    return [baseUrl];
  }
}

async function fetchPage(url: string, deps: Dependencies) {
  const response = await withRetries(() => deps.fetch(url), 1);
  if (!response.ok) {
    throw new Error(`Fetch failed for ${url} with ${response.status}.`);
  }
  const html = await response.text();
  return buildPageRecord(url, html, "company_enrich", "page");
}

async function discoverFallbackUrls(companyName: string, baseUrl: string, deps: Dependencies): Promise<string[]> {
  const domain = domainFromUrl(baseUrl);
  const providers = getSearchProviders();
  const queries = [
    ...(domain ? [`site:${domain} ${companyName} contact`, `site:${domain} ${companyName} careers`, `site:${domain} ${companyName} team`] : []),
    `${companyName} berlin contact`,
    `${companyName} berlin careers`,
    `${companyName} linkedin`,
  ];
  const urls = new Set<string>();
  for (const provider of providers) {
    for (const query of queries) {
      try {
        const results = await provider.search(
          { lane: "company_watch", locale: "en", query, family: "company" },
          deps,
        );
        for (const result of results) {
          const resultDomain = domainFromUrl(result.url);
          if ((domain && resultDomain === domain) || /linkedin\.com/i.test(result.url) || result.title.toLowerCase().includes(companyName.toLowerCase())) {
            urls.add(result.url);
          }
        }
      } catch {
        // Best-effort fallback only.
      }
      if (urls.size >= 8) break;
    }
    if (urls.size >= 8) break;
  }
  return [...urls];
}

function inferPitchTheme(text: string, name: string, existing?: string): PitchTheme {
  const blob = `${name} ${text}`.toLowerCase();
  if (/(ai|agent|automation|workflow|llm|generative)/.test(blob)) return "ai_workflows";
  if (/(design|product|creative|brand|ux|ui)/.test(blob) && /(frontend|react|typescript|software|platform|api)/.test(blob)) {
    return "design_engineering";
  }
  if (/(design|product|creative|brand|ux|ui)/.test(blob)) return "design";
  if (/(startup|seed|series a|small team|0-1)/.test(blob)) return "startup_speed";
  return (existing as PitchTheme | undefined) ?? "generalist";
}

function inferPitchAngle(theme: PitchTheme, name: string, existing?: string): string {
  if (existing) return existing;
  switch (theme) {
    case "ai_workflows":
      return `Lead with AI workflow design, product thinking, and prototyping for ${name}.`;
    case "design_engineering":
      return `Lead with hybrid design-and-build execution for ${name}.`;
    case "design":
      return `Lead with product design, visual systems, and brand clarity for ${name}.`;
    case "startup_speed":
      return `Lead with fast startup execution and product-minded adaptability for ${name}.`;
    default:
      return `Lead with product design, frontend execution, and startup-friendly versatility for ${name}.`;
  }
}

function genericStageLabel(value: string): boolean {
  return GENERIC_STAGE_LABELS.has(value.trim().toLowerCase());
}

function inferStageText(text: string, existing?: string): string {
  const blob = text.toLowerCase();
  if (/\bpre[- ]seed\b/.test(blob)) return "pre-seed";
  if (/\bseed\b/.test(blob)) return "seed";
  if (/\bseries a\b/.test(blob)) return "series a";
  if (/\bseries b\b/.test(blob)) return "series b";
  if (/\bseries c\b|\bgrowth stage\b/.test(blob)) return "growth stage";
  if (/\bsmall team\b|\b0-1\b|\bearly stage\b|\bfounding team\b/.test(blob)) return "early-stage team";
  if (/\bstartup\b/.test(blob)) return "startup";
  return genericStageLabel(existing ?? "") ? "" : (existing ?? "");
}

function stageScore(stageText: string, text: string): number {
  const stage = stageText.toLowerCase();
  if (stage === "pre-seed") return 18;
  if (stage === "seed") return 16;
  if (stage === "series a") return 14;
  if (stage === "series b") return 10;
  if (stage === "growth stage") return 7;
  if (stage === "early-stage team") return 15;
  if (stage === "startup") return 12;
  return /\bstartup\b|\bfounding\b|\bsmall team\b/.test(text.toLowerCase()) ? 10 : 0;
}

function stageSignalCount(text: string): number {
  const signals = [
    /\bpre[- ]seed\b/i,
    /\bseed\b/i,
    /\bseries a\b/i,
    /\bseries b\b/i,
    /\bearly stage\b/i,
    /\bfounding team\b/i,
    /\bsmall team\b/i,
    /\bventure backed\b/i,
    /\bbacked by\b/i,
    /\b0-1\b/i,
    /\bstartup\b/i,
  ];
  return signals.reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);
}

function inferSizeBand(text: string, existing?: string): string {
  const blob = text.toLowerCase();
  if (/\b1-10\b|\b2-10\b|\bsmall team\b|\bunder 10\b/.test(blob)) return "1-10";
  if (/\b11-50\b|\b10-50\b/.test(blob)) return "11-50";
  if (/\b51-200\b|\b50-200\b/.test(blob)) return "51-200";
  if (/\b201-500\b|\b200-500\b/.test(blob)) return "201-500";
  return existing ?? "";
}

function stageTrustScore(stageText: string, text: string, sizeBand: string): number {
  let score = 0;
  if (stageText === "pre-seed" || stageText === "seed") score += 3;
  else if (stageText === "series a" || stageText === "early-stage team") score += 2;
  else if (stageText === "startup") score += 1;
  score += Math.min(stageSignalCount(text), 3);
  if (sizeBand === "1-10" || sizeBand === "11-50") score += 1;
  return score;
}

function pathMatches(url: string, pattern: RegExp): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return pattern.test(pathname);
  } catch {
    return false;
  }
}

function matchingExistingUrl(value: unknown, pattern: RegExp): string {
  const candidate = typeof value === "string" ? value : "";
  return candidate && pathMatches(candidate, pattern) ? candidate : "";
}

function scoreFallbackPage(baseUrl: string, page: ReturnType<typeof buildPageRecord>): number {
  const pageDomain = domainFromUrl(page.url);
  const baseDomain = domainFromUrl(baseUrl);
  let score = 0;
  if (pageDomain && baseDomain && pageDomain === baseDomain) score += 20;
  if (/linkedin\.com/i.test(page.url)) score -= 20;
  if (pathMatches(page.url, /^\/$/)) score += 12;
  if (pathMatches(page.url, /\/(contact|about|team|careers?|jobs?)(\/|$)/i)) score += 10;
  if (page.text.length > 300) score += 6;
  return score;
}

export function resolveCompanyBestContact(company: CompanyRow): string {
  const publicContacts = parseJsonList(company.public_contacts);
  const companyDomain = normalizedCompanyDomain(String(company.domain ?? domainFromUrl(String(company.company_url ?? "")) ?? ""));
  const strongDirectEmail = publicContacts
    .filter((entry) => /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(entry) && !isPlaceholderEmail(entry))
    .map((email) => ({
      email,
      score: scoreContactCandidate(companyDomain, {
        kind: "general_contact_email",
        name: "",
        title: "",
        email,
        linkedinUrl: "",
        sourceUrl: String(company.contact_url ?? company.company_url ?? ""),
        confidence: "medium",
        evidenceType: "explicit_email",
        evidenceExcerpt: email,
        isPublic: true,
        pageType: "generic",
      }),
    }))
    .filter(({ score }) => score >= 54)
    .sort((left, right) => right.score - left.score)[0]?.email;
  if (strongDirectEmail) return strongDirectEmail;

  const prioritizedLinks = [
    String(company.contact_url ?? ""),
    String(company.team_url ?? ""),
    String(company.linkedin_url ?? ""),
    String(company.careers_url ?? ""),
    ...publicContacts.filter((entry) => /^https?:\/\//i.test(entry)),
    String(company.company_url ?? ""),
  ].filter(Boolean);

  return prioritizedLinks[0] ?? "";
}

export function mapContactsToRecords(companyCanonicalKey: string, contacts: ContactCandidate[]): ContactRecordInput[] {
  const timestamp = new Date().toISOString();
  return dedupeContacts(contacts).map((contact) => ({
    canonicalKey: canonicalContactKey(contact.email, contact.linkedinUrl, contact.name || contact.sourceUrl, companyCanonicalKey),
    companyCanonicalKey,
    name: contact.name,
    title: contact.title,
    email: contact.email,
    sourceUrl: contact.sourceUrl,
    linkedinUrl: contact.linkedinUrl,
    contactKind: contact.kind,
    notes: "company_enrich",
    confidence: contact.confidence,
    evidenceType: contact.evidenceType,
    evidenceExcerpt: contact.evidenceExcerpt,
    isPublic: contact.isPublic,
    lastVerifiedAt: timestamp,
    pageType: contact.pageType,
    lastSeenAt: timestamp,
  }));
}

export async function enrichCompanyFromWeb(
  company: CompanyRow,
  deps: Dependencies,
): Promise<{ companyInput: CompanyRecordInput; contacts: ContactRecordInput[]; pagesChecked: number }> {
  const baseUrl = String(company.company_url ?? "") || (String(company.domain ?? "") ? `https://${String(company.domain)}` : "");
  if (!baseUrl) {
    throw new Error(`Company ${String(company.name ?? "unknown")} has no known domain.`);
  }

  let homepagePage = null as ReturnType<typeof buildPageRecord> | null;
  const homepageErrors: string[] = [];
  for (const candidate of alternateHomepageUrls(baseUrl)) {
    try {
      homepagePage = await fetchPage(candidate, deps);
      break;
    } catch (error) {
      homepageErrors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (!homepagePage) {
    const fallbackUrls = await discoverFallbackUrls(String(company.name ?? ""), baseUrl, deps);
    const fallbackPages = await mapLimit(fallbackUrls, 4, async (url) => {
      try {
        return await fetchPage(url, deps);
      } catch {
        return null;
      }
    });
    const viablePages = fallbackPages.filter((page): page is NonNullable<typeof page> => Boolean(page));
    if (!viablePages.length) {
      throw new Error(homepageErrors[0] ?? `Homepage fetch failed for ${baseUrl}.`);
    }
    homepagePage = [...viablePages].sort((left, right) => scoreFallbackPage(baseUrl, right) - scoreFallbackPage(baseUrl, left))[0]!;
  }

  const discoveredUrls = collectDiscoveredUrls(homepagePage.url, homepagePage.html);
  const pages = [homepagePage];

  const fetchedPages = await mapLimit(discoveredUrls.slice(1), 4, async (url) => {
    try {
      const response = await withRetries(() => deps.fetch(url), 1);
      if (!response.ok) return null;
      const html = await response.text();
      return buildPageRecord(url, html, "company_enrich", "page");
    } catch {
      return null;
    }
  });
  pages.push(...fetchedPages.filter((page): page is NonNullable<typeof page> => Boolean(page)));

  const companyDomain = normalizedCompanyDomain(String(company.domain ?? domainFromUrl(homepagePage.url) ?? domainFromUrl(baseUrl) ?? ""));
  const contacts = sortContactsForCompany(companyDomain, dedupeContacts(pages.flatMap((page) => extractContacts(page))));
  const publicContacts = uniqueNonEmpty(contacts.map((contact) => contact.email || contact.linkedinUrl || contact.sourceUrl));
  const strongDirectEmails = contacts.filter((contact) => isStrongDirectEmail(companyDomain, contact));
  const usableDirectEmails = contacts.filter((contact) => isUsableDirectEmail(companyDomain, contact));
  const bestContact = contacts[0];
  const combinedText = pages.map((page) => page.text).join(" ");
  const theme = inferPitchTheme(combinedText, String(company.name ?? ""), String(company.pitch_theme ?? ""));
  const inferredStageText = inferStageText(combinedText, String(company.stage_text ?? ""));
  const inferredSizeBand = inferSizeBand(combinedText, String(company.size_band ?? ""));
  const trustScore = stageTrustScore(inferredStageText, combinedText, inferredSizeBand);
  const existingSourceUrls = parseJsonList(company.source_urls);
  const startupSignals = uniqueNonEmpty([
    ...parseJsonList(company.startup_signals),
    ...(/startup|seed|series a|series b|founding|small team|0-1|pre-seed|early stage/i.test(combinedText) ? ["startup_language"] : []),
  ]);
  const hiringSignals = uniqueNonEmpty([
    ...parseJsonList(company.hiring_signals),
    ...(/careers|jobs|hiring|join us|open roles|we are hiring|we're hiring/i.test(combinedText) ? ["hiring_language"] : []),
    ...(publicContacts.length ? ["public_contact_surface"] : []),
  ]);

  const teamUrl =
    pages.find((page) => pathMatches(page.url, /\/(team|leadership|founders?)(\/|$)/i))?.url ||
    matchingExistingUrl(company.team_url, /\/(team|leadership|founders?)(\/|$)/i);
  const contactUrl =
    pages.find((page) => pathMatches(page.url, /\/(contact|imprint|legal|privacy)(\/|$)/i))?.url ||
    matchingExistingUrl(company.contact_url, /\/(contact|imprint|legal|privacy)(\/|$)/i);
  const careersUrl =
    pages.find((page) => pathMatches(page.url, /\/(careers?|jobs?|join)(\/|$)/i))?.url ||
    matchingExistingUrl(company.careers_url, /\/(careers?|jobs?|join)(\/|$)/i);
  const aboutUrl =
    pages.find((page) => pathMatches(page.url, /\/about(\/|$)/i))?.url ||
    matchingExistingUrl(company.about_url, /\/about(\/|$)/i);
  const linkedinUrl =
    contacts.find((contact) => contact.kind === "linkedin_company")?.linkedinUrl ||
    String(company.linkedin_url ?? "");

  const bestContactScore = bestContact ? scoreContactCandidate(companyDomain, bestContact) : 0;
  const contactabilityScore = Math.max(
    Number(company.contactability_score ?? 0),
    strongDirectEmails.length > 0 ? 14 : usableDirectEmails.length > 0 ? 10 : bestContactScore >= 18 ? 7 : publicContacts.length > 0 ? 5 : 0,
  );
  const bestRoute =
    strongDirectEmails.length > 0
      ? "direct_email_first"
      : usableDirectEmails.length > 0 || contacts.some((contact) => contact.kind === "linkedin_person" || contact.kind === "team_page")
        ? "founder_or_team_reachout"
        : publicContacts.length > 0
          ? "watch_company"
          : (String(company.best_route ?? "watch_company") as CompanyRecordInput["bestRoute"]);

  const recommendation =
    strongDirectEmails.length > 0
      ? "cold_email"
      : usableDirectEmails.length > 0 || bestContactScore >= 18
        ? "enrich_first"
        : (String(company.recommendation ?? "watch") as CompanyRecordInput["recommendation"]);

  const companyCanonicalKey = String(company.canonical_key);
  const companyInput: CompanyRecordInput = {
    canonicalKey: companyCanonicalKey,
    name: String(company.name ?? ""),
    domain: String(company.domain ?? domainFromUrl(baseUrl)),
    location: /berlin/i.test(combinedText) ? "Berlin" : String(company.location ?? ""),
    companyUrl: homepagePage.url || baseUrl,
    careersUrl,
    aboutUrl,
    teamUrl,
    contactUrl,
    pressUrl: String(company.press_url ?? ""),
    linkedinUrl,
    description: homepagePage.text.slice(0, 1600) || String(company.description ?? ""),
    sourceUrls: uniqueNonEmpty([baseUrl, ...discoveredUrls, ...existingSourceUrls]),
    publicContacts,
    startupSignals,
    hiringSignals,
    founderNames: parseJsonList(company.founder_names),
    cities: uniqueNonEmpty([String(company.location ?? ""), /berlin/i.test(combinedText) ? "Berlin" : ""]),
    sizeBand: inferredSizeBand || String(company.size_band ?? ""),
    stageText: trustScore >= 2 ? (inferredStageText || (startupSignals.length ? "startup" : "")) : "",
    remotePolicy: /remote|hybrid/i.test(combinedText) ? "remote-friendly" : String(company.remote_policy ?? ""),
    openRoleCount: Math.max(Number(company.open_role_count ?? 0), /open roles|jobs|careers|join us/i.test(combinedText) ? 1 : 0),
    startupScore: trustScore >= 2 ? stageScore(inferredStageText, combinedText) : Math.min(Number(company.startup_score ?? 0), 8),
    companyFitScore: Math.max(Number(company.company_fit_score ?? 0), 8),
    hiringSignalScore: Math.max(Number(company.hiring_signal_score ?? 0), hiringSignals.length * 4),
    contactabilityScore,
    isStartupCandidate: trustScore >= 2 || Boolean(Number(company.is_startup_candidate ?? 0) && !genericStageLabel(String(company.stage_text ?? ""))),
    recommendation,
    recommendationReason:
      strongDirectEmails.length > 0
        ? "High-quality company-domain public email found on company pages."
        : usableDirectEmails.length > 0 || bestContactScore >= 18
          ? "A usable contact surface exists, but the best route still needs a quality check."
          : String(company.recommendation_reason ?? ""),
    bestRoute,
    pitchTheme: theme,
    pitchAngle: inferPitchAngle(theme, String(company.name ?? ""), String(company.pitch_angle ?? "")),
    pitchEvidence: uniqueNonEmpty([
      ...parseJsonList(company.pitch_evidence),
      ...(strongDirectEmails.length > 0 ? ["High-quality direct public email found"] : []),
      ...(usableDirectEmails.length > 0 && strongDirectEmails.length === 0 ? ["Usable but lower-quality public email found"] : []),
      ...(publicContacts.some((entry) => /linkedin\.com/i.test(entry)) ? ["LinkedIn contact surface found"] : []),
      ...(contactUrl ? ["Contact page found"] : []),
      ...(careersUrl ? ["Careers page found"] : []),
      ...(trustScore >= 2 && inferredStageText ? [`Stage evidence: ${inferredStageText}`] : []),
    ]),
    directContactCount: Math.max(Number(company.direct_contact_count ?? 0), usableDirectEmails.length),
    reachableNow: usableDirectEmails.length > 0 || publicContacts.length > 0,
    priorityBand:
      strongDirectEmails.length > 0
        ? "high"
        : usableDirectEmails.length > 0 || bestContactScore >= 18
          ? "medium"
          : (String(company.priority_band ?? "low") as CompanyRecordInput["priorityBand"]),
    lastSeenAt: new Date().toISOString(),
  };

  return {
    companyInput,
    contacts: mapContactsToRecords(companyCanonicalKey, contacts),
    pagesChecked: pages.length,
  };
}
