import * as cheerio from "cheerio";
import { canonicalCompanyKey, domainFromUrl, normalizeUrl } from "../lib/url.js";
import { mapLimit, withTimeout } from "../lib/async.js";
import { enrichCompanyFromWeb } from "../ingestion/company-enrich.js";
import { openDatabase, upsertCompany, upsertContact } from "../state/db.js";
import type { CompanyRecordInput, Dependencies, FundedStartupSource } from "../types.js";

interface FundedStartupCandidate {
  name: string;
  website: string;
  stageText: string;
  sizeBand: string;
  location: string;
  description: string;
  sourceUrl: string;
  sourceName: string;
  sourceProvider: FundedStartupSource["provider"];
  publishedAt: string;
  fundingText: string;
  startupSignals: string[];
  hiringSignals: string[];
  founderNames: string[];
}

const SOURCE_HOST_BLOCKLIST = [
  "handpickedberlin.com",
  "tech.eu",
  "eu-startups.com",
  "project-a.vc",
  "linkedin.com",
  "instagram.com",
  "youtube.com",
  "tiktok.com",
  "reddit.com",
  "x.com",
  "twitter.com",
  "facebook.com",
];

function normalizeHost(value: string): string {
  return value.toLowerCase().replace(/^www\./i, "");
}

function isOfficialWebsite(url: string): boolean {
  const host = normalizeHost(domainFromUrl(url));
  return Boolean(host) && !SOURCE_HOST_BLOCKLIST.includes(host);
}

function textBlob($: cheerio.CheerioAPI): string {
  return $("main").text().replace(/\s+/g, " ").trim() || $("body").text().replace(/\s+/g, " ").trim();
}

function normalizeCompanyName(name: string): string {
  return name.replace(/\s+/g, " ").replace(/\b(careers?|jobs?)\b/i, "").trim();
}

function inferStageText(text: string): string {
  const blob = text.toLowerCase();
  if (/\bpre[- ]seed\b/.test(blob)) return "pre-seed";
  if (/\bseed\b/.test(blob)) return "seed";
  if (/\bseries a\b/.test(blob)) return "series a";
  if (/\bseries b\b/.test(blob)) return "series b";
  if (/\bseries c\b|\bseries d\b|\bgrowth\b/.test(blob)) return "growth";
  if (/\bearly stage\b|\bfounding team\b|\bsmall team\b|\b0-1\b/.test(blob)) return "early";
  if (/\bventure backed\b|\bbacked by\b|\braised\b/.test(blob)) return "funded";
  return "";
}

function stageRank(stageText: string): number {
  const stage = stageText.toLowerCase();
  if (stage === "pre-seed") return 6;
  if (stage === "seed") return 5;
  if (stage === "series a") return 4;
  if (stage === "series b") return 3;
  if (stage === "growth") return 2;
  if (stage === "early") return 5;
  if (stage === "funded") return 3;
  return 1;
}

function inferSizeBand(text: string): string {
  const blob = text.toLowerCase();
  if (/\b(1-10|2-10|3-10|5-10)\b/.test(blob)) return "1-10";
  if (/\b(11-50|10-50|20-50)\b/.test(blob)) return "11-50";
  if (/\b(51-200|50-200|100-200)\b/.test(blob)) return "51-200";
  if (/\b(201-500|200-500)\b/.test(blob)) return "201-500";
  if (/\bsmall team\b|\bfounding team\b|\b0-1\b/.test(blob)) return "1-10";
  return "";
}

function designProductFitScore(text: string): number {
  const blob = text.toLowerCase();
  const positives = [
    /ai|agent|workflow|automation|developer tool|devtool|context layer/,
    /product|design|creative|interface|ui|ux|collaboration|tool/,
    /saas|platform|software|b2b/,
  ];
  const negatives = [
    /biotech|pharma|factory|logistics infrastructure|battery storage/,
    /heavy hardware|robotics/i,
    /solar installation|pv-anlagen|photovoltaik|energetische modernisierung|energiewende.*kommun|liegenschaften|baubegleitung|modernisierungsprojekt/i,
    /construction|contractor|building renovation|infrastructure.*service|municipal service/i,
    /consulting|consultancy|dienstleistung|service provider|managed service/i,
  ];

  const positiveScore = positives.reduce((count, pattern) => count + (pattern.test(blob) ? 1 : 0), 0);
  const negativeScore = negatives.reduce((count, pattern) => count + (pattern.test(blob) ? 1 : 0), 0);
  return Math.max(4, 8 + positiveScore * 3 - negativeScore * 2);
}

function fundingRecencyScore(publishedAt: string): number {
  const timestamp = Date.parse(publishedAt);
  if (Number.isNaN(timestamp)) return 6;
  const ageDays = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
  if (ageDays <= 30) return 18;
  if (ageDays <= 90) return 14;
  if (ageDays <= 180) return 10;
  if (ageDays <= 365) return 7;
  return 4;
}

function buildContactSurface(url: string): { publicContacts: string[]; contactUrl: string; careersUrl: string } {
  if (!url) {
    return { publicContacts: [], contactUrl: "", careersUrl: "" };
  }
  const normalized = normalizeUrl(url);
  const domain = normalizeHost(domainFromUrl(normalized));
  if (!domain) {
    return { publicContacts: [], contactUrl: "", careersUrl: "" };
  }
  return {
    publicContacts: [],
    contactUrl: `${new URL("/contact", normalized).toString()}`,
    careersUrl: /careers|jobs|join/i.test(normalized) ? normalized : `${new URL("/careers", normalized).toString()}`,
  };
}

function candidateToCompanyInput(candidate: FundedStartupCandidate): CompanyRecordInput {
  const stage = candidate.stageText || inferStageText(`${candidate.description} ${candidate.fundingText}`);
  const rank = stageRank(stage);
  const fundingScore = fundingRecencyScore(candidate.publishedAt);
  const route = buildContactSurface(candidate.website);
  const domain = normalizeHost(domainFromUrl(candidate.website));
  return {
    canonicalKey: canonicalCompanyKey(candidate.name, domain),
    name: candidate.name,
    domain,
    location: candidate.location,
    companyUrl: candidate.website,
    careersUrl: route.careersUrl,
    aboutUrl: "",
    teamUrl: "",
    contactUrl: route.contactUrl,
    pressUrl: "",
    linkedinUrl: "",
    description: `${candidate.description} ${candidate.fundingText}`.trim(),
    sourceUrls: [candidate.sourceUrl],
    publicContacts: route.publicContacts,
    startupSignals: [...candidate.startupSignals, "funded_berlin_startups"],
    hiringSignals: candidate.hiringSignals,
    founderNames: candidate.founderNames,
    cities: ["Berlin"],
    sizeBand: candidate.sizeBand || inferSizeBand(candidate.description),
    stageText: stage,
    remotePolicy: "",
    openRoleCount: /careers|jobs|hiring|join us/i.test(candidate.website) ? 1 : 0,
    startupScore: Math.min(20, rank * 3 + fundingScore),
    companyFitScore: Math.min(18, designProductFitScore(candidate.description)),
    hiringSignalScore: /careers|jobs|join|hiring/i.test(candidate.website) ? 10 : 5,
    contactabilityScore: domain ? 8 : 4,
    isStartupCandidate: true,
    recommendation: "cold_email",
    recommendationReason: `Recent ${stage || "funding"} signal from ${candidate.sourceName}.`,
    bestRoute: "direct_email_first",
    pitchTheme: /ai|agent|workflow|automation/i.test(candidate.description) ? "ai_workflows" : "design_engineering",
    pitchAngle: `Lead with product design plus implementation-minded prototyping for ${candidate.name}.`,
    pitchEvidence: [
      `Recent funding signal: ${candidate.fundingText || stage || "funded Berlin startup"}`,
      `${candidate.sourceName} seed source`,
      "Berlin startup target",
    ],
    directContactCount: domain ? 1 : 0,
    reachableNow: Boolean(domain),
    priorityBand: rank >= 5 ? "high" : rank >= 3 ? "medium" : "low",
    lastSeenAt: new Date().toISOString(),
  };
}

function officialLinks($: cheerio.CheerioAPI, baseUrl: string): Array<{ name: string; href: string }> {
  return $("a[href]")
    .map((_, element) => {
      const href = $(element).attr("href") ?? "";
      const text = normalizeCompanyName($(element).text());
      try {
        const resolved = new URL(href, baseUrl).toString();
        return { name: text, href: resolved };
      } catch {
        return { name: text, href: "" };
      }
    })
    .get()
    .filter((entry) => entry.href && isOfficialWebsite(entry.href));
}

function extractCompanyContext(body: string, companyName: string): string {
  const index = body.toLowerCase().indexOf(companyName.toLowerCase());
  if (index === -1) return body.slice(0, 240);
  return body.slice(Math.max(0, index - 40), Math.min(body.length, index + 260));
}

function parseHandpickedArticle(source: FundedStartupSource, html: string): FundedStartupCandidate[] {
  const $ = cheerio.load(html);
  const body = textBlob($);
  const publishedAt = $("meta[property='article:published_time']").attr("content") ?? "";
  const candidates = new Map<string, FundedStartupCandidate>();
  for (const link of officialLinks($, source.url)) {
    if (!link.name || link.name.length < 2 || /\babout|contact|jobs|careers\b/i.test(link.name)) continue;
    const context = extractCompanyContext(body, link.name);
    candidates.set(normalizeHost(domainFromUrl(link.href)) || link.name.toLowerCase(), {
      name: link.name,
      website: link.href,
      stageText: inferStageText(context),
      sizeBand: inferSizeBand(context),
      location: /berlin/i.test(context) ? "Berlin" : "Berlin",
      description: context,
      sourceUrl: source.url,
      sourceName: source.name,
      sourceProvider: source.provider,
      publishedAt,
      fundingText: context.match(/(?:€|\$)\s?\d[\d.,]*(?:\s?[MBKmbk]+)?(?:\s+(?:pre-seed|seed|series [a-d]))?/i)?.[0] ?? "",
      startupSignals: ["berlin_funding_article"],
      hiringSignals: [/careers|jobs|join us|hiring/i.test(link.href) ? "careers_surface" : ""].filter(Boolean),
      founderNames: [],
    });
  }
  return [...candidates.values()].slice(0, source.maxCompanies ?? 20);
}

function parseHandpickedIndex(source: FundedStartupSource, html: string): string[] {
  const $ = cheerio.load(html);
  return $("a[href]")
    .map((_, element) => $(element).attr("href") ?? "")
    .get()
    .map((href) => {
      try {
        return new URL(href, source.url).toString();
      } catch {
        return "";
      }
    })
    .filter((href) => /handpickedberlin\.com\/list-of-funded-startups-in-berlin/i.test(href))
    .slice(0, source.maxCompanies ?? 8);
}

function parseTechOrEuArticle(source: FundedStartupSource, html: string): FundedStartupCandidate[] {
  const $ = cheerio.load(html);
  const title = $("meta[property='og:title']").attr("content") || $("title").text().trim();
  const body = textBlob($);
  const companyName = normalizeCompanyName(title.split(" closes ")[0]?.split(" raises ")[0]?.split(" secures ")[0] ?? title.replace(/ - .*$/, ""));
  const website = officialLinks($, source.url).find((link) => new RegExp(companyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(link.name))?.href ?? "";
  return [{
    name: companyName,
    website,
    stageText: inferStageText(`${title} ${body}`),
    sizeBand: inferSizeBand(body),
    location: /berlin/i.test(`${title} ${body}`) ? "Berlin" : "",
    description: body.slice(0, 500),
    sourceUrl: source.url,
    sourceName: source.name,
    sourceProvider: source.provider,
    publishedAt: $("meta[property='article:published_time']").attr("content") ?? $("meta[property='og:updated_time']").attr("content") ?? "",
    fundingText: `${title} ${body}`.match(/(?:€|\$)\s?\d[\d.,]*(?:\s?(?:million|billion|m|bn))?(?:\s+(?:pre-seed|seed|series [a-d]))?/i)?.[0] ?? "",
    startupSignals: ["berlin_funding_article"],
    hiringSignals: [],
    founderNames: [],
  }];
}

function parseVcPortfolio(source: FundedStartupSource, html: string): FundedStartupCandidate[] {
  const $ = cheerio.load(html);
  return officialLinks($, source.url)
    .map((link) => {
      const name = link.name.startsWith("http") ? normalizeCompanyName(domainFromUrl(link.href).split(".")[0] ?? "") : link.name;
      return {
        name: name.replace(/-/g, " "),
        website: link.href,
        stageText: "funded",
        sizeBand: "",
        location: "",
        description: `VC portfolio company surfaced from ${source.name}. Homepage enrichment must confirm Berlin relevance before it can rank as a daily recommendation.`,
        sourceUrl: source.url,
        sourceName: source.name,
        sourceProvider: source.provider,
        publishedAt: "",
        fundingText: "VC-backed portfolio company",
        startupSignals: ["vc_portfolio", "funded_company"],
        hiringSignals: [],
        founderNames: [],
      } satisfies FundedStartupCandidate;
    })
    .filter((candidate) => candidate.name.length >= 2)
    .slice(0, source.maxCompanies ?? 30);
}

async function fetchHtml(url: string, deps: Dependencies): Promise<string> {
  const response = await deps.fetch(url);
  if (!response.ok) {
    throw new Error(`Fetch failed for ${url} with ${response.status}`);
  }
  return response.text();
}

async function parseSource(source: FundedStartupSource, deps: Dependencies): Promise<FundedStartupCandidate[]> {
  const html = await withTimeout(fetchHtml(source.url, deps), 15000, source.name);
  if (source.provider === "handpicked_berlin_index") {
    const articleUrls = parseHandpickedIndex(source, html);
    const articleCandidates = await mapLimit(articleUrls, 2, async (articleUrl) => {
      const articleSource: FundedStartupSource = {
        name: `${source.name} article`,
        provider: "handpicked_berlin_article",
        url: articleUrl,
        maxCompanies: source.maxCompanies,
      };
      try {
        const articleHtml = await withTimeout(fetchHtml(articleUrl, deps), 15000, articleUrl);
        return parseHandpickedArticle(articleSource, articleHtml);
      } catch {
        return [] as FundedStartupCandidate[];
      }
    });
    return articleCandidates.flat();
  }
  if (source.provider === "handpicked_berlin_article") {
    return parseHandpickedArticle(source, html);
  }
  if (source.provider === "vc_portfolio") {
    return parseVcPortfolio(source, html);
  }
  return parseTechOrEuArticle(source, html);
}

async function enrichFundedCompanies(baseDir: string, deps: Dependencies, companyKeys: string[], mode: "normal" | "deep"): Promise<void> {
  const { db } = openDatabase(baseDir);
  const companies = db.prepare(`
    SELECT canonical_key, name, domain, company_url, stage_text, size_band, source_urls, startup_signals, hiring_signals,
           founder_names, pitch_theme, pitch_angle, contactability_score, recommendation, recommendation_reason, best_route,
           priority_band, direct_contact_count, reachable_now, is_startup_candidate, open_role_count, company_fit_score,
           hiring_signal_score, location, description, team_url, contact_url, careers_url, about_url, press_url, linkedin_url
    FROM companies
    WHERE canonical_key IN (${companyKeys.map(() => "?").join(",")})
  `).all(...companyKeys) as Array<Record<string, unknown>>;

  const cap = mode === "deep" ? 10 : 6;
  await mapLimit(companies.slice(0, cap), 2, async (company) => {
    try {
      const result = await withTimeout(
        enrichCompanyFromWeb(company, deps),
        mode === "deep" ? 18000 : 12000,
        `enrich:${String(company.name ?? "")}`,
      );
      upsertCompany(db, result.companyInput);
      for (const contact of result.contacts) {
        upsertContact(db, contact);
      }
    } catch {
      return;
    }
  });
}

export async function ingestFundedBerlinStartups(
  baseDir: string,
  deps: Dependencies,
  sources: FundedStartupSource[],
  mode: "normal" | "deep",
): Promise<{ sourcesAttempted: string[]; warnings: string[]; companiesUpserted: number }> {
  const { db } = openDatabase(baseDir);
  const selected = mode === "deep" ? sources : sources.slice(0, 4);
  const sourcesAttempted: string[] = [];
  const warnings: string[] = [];
  const seenDomains = new Set<string>();
  const upsertedKeys = new Set<string>();

  const parsed = await mapLimit(selected, 2, async (source) => {
    sourcesAttempted.push(`funded:${source.name}`);
    try {
      return await parseSource(source, deps);
    } catch (error) {
      warnings.push(`funded:${source.name} failed: ${error instanceof Error ? error.message : String(error)}`);
      return [] as FundedStartupCandidate[];
    }
  });

  for (const candidate of parsed.flat()) {
    const website = candidate.website && isOfficialWebsite(candidate.website) ? normalizeUrl(candidate.website) : "";
    const domain = normalizeHost(domainFromUrl(website));
    if (!candidate.name || !/berlin/i.test(`${candidate.location} ${candidate.description} ${candidate.fundingText} ${candidate.sourceName}`)) continue;
    if (domain && seenDomains.has(domain)) continue;
    const companyInput = candidateToCompanyInput({ ...candidate, website });
    const companyId = upsertCompany(db, companyInput);
    upsertedKeys.add(companyInput.canonicalKey);
    if (domain) {
      seenDomains.add(domain);
    }
    void companyId;
  }

  await enrichFundedCompanies(baseDir, deps, [...upsertedKeys], mode);

  return {
    sourcesAttempted,
    warnings,
    companiesUpserted: upsertedKeys.size,
  };
}

export const fundedBerlinInternals = {
  inferStageText,
  inferSizeBand,
  stageRank,
  parseHandpickedArticle,
  parseVcPortfolio,
};
