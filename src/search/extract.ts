import * as cheerio from "cheerio";
import { classifyPageType } from "./classify.js";
import { decodeEntities, excerptAround, extractYearRequirement, summarizeToLine, uniqueNonEmpty } from "../lib/text.js";
import { domainFromUrl, normalizeUrl } from "../lib/url.js";
import type { ContactCandidate, ListingCandidate, PageRecord, SearchLane } from "../types.js";

function inferWorkModel(text: string): ListingCandidate["workModel"] {
  const lower = text.toLowerCase();
  if (lower.includes("remote") || lower.includes("telecommute") || lower.includes("uzaktan")) return "remote";
  if (lower.includes("hybrid")) return "hybrid";
  if (lower.includes("onsite") || lower.includes("on-site")) return "onsite";
  return "unknown";
}

function contactFromEmail(email: string, sourceUrl: string, evidenceExcerpt: string, pageType: ContactCandidate["pageType"], kind: ContactCandidate["kind"]): ContactCandidate {
  return {
    kind,
    name: "",
    title: "",
    email,
    linkedinUrl: "",
    sourceUrl,
    confidence: kind === "application_email" || kind === "careers_email" ? "high" : "medium",
    evidenceType: "explicit_email",
    evidenceExcerpt,
    isPublic: true,
    pageType,
  };
}

function contactFromLink(link: string, sourceUrl: string, pageType: ContactCandidate["pageType"], kind: ContactCandidate["kind"]): ContactCandidate {
  return {
    kind,
    name: "",
    title: "",
    email: "",
    linkedinUrl: link.includes("linkedin.com") ? link : "",
    sourceUrl,
    confidence: kind === "linkedin_company" ? "medium" : "low",
    evidenceType: "public_link",
    evidenceExcerpt: link,
    isPublic: true,
    pageType,
  };
}

function sanitizeEmail(value: string): string {
  return value.replace(/^mailto:/i, "").split("?")[0]!.trim();
}

function looksLikePlaceholderEmail(email: string): boolean {
  const lower = email.toLowerCase();
  return (
    lower.endsWith("@example.com") ||
    lower.endsWith("@company.com") ||
    lower.includes("max.mustermann") ||
    lower.includes("john.doe") ||
    lower.includes("jane.doe") ||
    /^name@/i.test(lower) ||
    lower.includes("do-not-reply") ||
    lower.includes("noreply") ||
    lower.includes("no-reply") ||
    lower.endsWith("@yourdomain.com") ||
    lower.endsWith("@doe.com") ||
    lower.endsWith("@tech.com") ||
    lower.includes("sentry.io") ||
    lower.includes("@2x") ||
    /\.(png|jpg|jpeg|svg|webp|gif)$/i.test(lower)
  );
}

function extractExplicitEmails(text: string): string[] {
  const emails = new Set<string>();
  const pattern = /(?:^|[^A-Z0-9._%+-])([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})(?![A-Z0-9._%+-])/gi;
  for (const match of text.matchAll(pattern)) {
    const email = match[1]?.trim();
    const surrounding = text.slice(Math.max(0, (match.index ?? 0) - 8), (match.index ?? 0) + (email?.length ?? 0) + 8);
    if (
      email &&
      email.length <= 254 &&
      /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email) &&
      !looksLikePlaceholderEmail(email) &&
      !/(@2x|\.png|\.jpg|\.jpeg|\.svg|\.webp|\.gif|noreply|no-reply|do-not-reply)/i.test(surrounding)
    ) {
      emails.add(email);
    }
  }
  return [...emails];
}

export function buildPageRecord(url: string, html: string, provider: string, sourceType: PageRecord["sourceType"]): PageRecord {
  const $ = cheerio.load(html);
  const text = $("body").text().replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();
  return {
    url,
    normalizedUrl: normalizeUrl(url),
    domain: domainFromUrl(url),
    sourceType,
    pageType: classifyPageType(url, text),
    intent: "unknown",
    title: $("title").text().trim(),
    text,
    html,
    provider,
  };
}

export function extractContacts(page: PageRecord): ContactCandidate[] {
  const $ = cheerio.load(page.html);
  const contacts: ContactCandidate[] = [];

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const text = $(element).text().trim();
    const lowerText = text.toLowerCase();
    if (href.startsWith("mailto:")) {
      const email = sanitizeEmail(href);
      if (looksLikePlaceholderEmail(email)) return;
      const kind =
        /(apply|career|job|cv)/i.test(text) ? "application_email" :
        /(press)/i.test(text) ? "press_email" :
        /(career|hiring|join)/i.test(lowerText) ? "careers_email" :
        "general_contact_email";
      contacts.push(contactFromEmail(email, page.url, text || email, page.pageType, kind));
      return;
    }
    if (/linkedin\.com\/company/i.test(href)) {
      contacts.push(contactFromLink(href, page.url, page.pageType, "linkedin_company"));
      return;
    }
    if (/linkedin\.com\/in\//i.test(href)) {
      contacts.push(contactFromLink(href, page.url, page.pageType, "linkedin_person"));
      return;
    }
    if (/(team|about|contact|careers|jobs|press|imprint)/i.test(lowerText)) {
      contacts.push(
        contactFromLink(
          new URL(href, page.url).toString(),
          page.url,
          page.pageType,
          /team/i.test(lowerText) ? "team_page" : "contact_form",
        ),
      );
    }
  });

  const rawText = page.html.replace(/<[^>]+>/g, " ");
  for (const email of extractExplicitEmails(rawText)) {
    const lower = email.toLowerCase();
    const kind: ContactCandidate["kind"] =
      lower.includes("careers") || lower.includes("jobs") ? "careers_email" :
      lower.includes("press") ? "press_email" :
      lower.includes("apply") ? "application_email" :
      "general_contact_email";
    contacts.push(contactFromEmail(email, page.url, excerptAround(page.text, email), page.pageType, kind));
  }

  const deduped = new Map<string, ContactCandidate>();
  for (const contact of contacts) {
    const key = contact.email || contact.linkedinUrl || `${contact.kind}:${contact.sourceUrl}`;
    deduped.set(key, contact);
  }
  return [...deduped.values()];
}

function listingFromStructuredEntry(
  entry: Record<string, unknown>,
  page: PageRecord,
  lane: SearchLane,
  contacts: ContactCandidate[],
): ListingCandidate {
  const hiringOrganization = (entry.hiringOrganization ?? {}) as Record<string, unknown>;
  const location = (entry.jobLocation as Record<string, unknown> | undefined)?.address as Record<string, unknown> | undefined;
  const title = decodeEntities(String(entry.title ?? page.title ?? "Untitled role"));
  const description = summarizeToLine(String(entry.description ?? page.text), 1200);
  const remoteScope =
    String(entry.jobLocationType ?? "").toUpperCase() === "TELECOMMUTE" ? "global" : "";
  const applicantLocationRequirements = Array.isArray(entry.applicantLocationRequirements)
    ? (entry.applicantLocationRequirements as Array<Record<string, unknown>>).map((item) => String(item.name ?? item.addressCountry ?? ""))
    : [];
  return {
    lane,
    externalId: String((entry.identifier as Record<string, unknown> | undefined)?.value ?? entry.identifier ?? page.normalizedUrl),
    title,
    titleFamily: "",
    company: String(hiringOrganization.name ?? page.domain ?? "Unknown"),
    location: String(location?.addressLocality ?? ""),
    country: String(location?.addressCountry ?? ""),
    language: /[ığüşöçİĞÜŞÖÇ]/.test(description) ? "tr" : "en",
    workModel: remoteScope ? "remote" : inferWorkModel(description),
    employmentType: String(entry.employmentType ?? ""),
    salary: JSON.stringify(entry.baseSalary ?? ""),
    description,
    url: normalizeUrl(String(entry.url ?? page.url)),
    applyUrl: normalizeUrl(String(entry.url ?? page.url)),
    source: page.provider,
    sourceType: page.sourceType,
    sourceUrls: uniqueNonEmpty([page.url, String(entry.url ?? "")]),
    companyUrl: page.domain ? `https://${page.domain}` : "",
    careersUrl: page.url,
    aboutUrl: "",
    teamUrl: "",
    contactUrl: "",
    pressUrl: "",
    companyLinkedinUrl: contacts.find((contact) => contact.kind === "linkedin_company")?.linkedinUrl ?? "",
    publicContacts: contacts,
    postedAt: String(entry.datePosted ?? ""),
    validThrough: String(entry.validThrough ?? ""),
    department: String((entry.department as Record<string, unknown> | undefined)?.name ?? entry.department ?? ""),
    experienceYearsText: extractYearRequirement(description),
    remoteScope,
    applicantLocationRequirements,
    applicationContactName: String((entry.applicationContact as Record<string, unknown> | undefined)?.name ?? ""),
    applicationContactEmail: String((entry.applicationContact as Record<string, unknown> | undefined)?.email ?? ""),
    parseConfidence: 0.95,
    sourceConfidence: 0.9,
    isRealJobPage: true,
    raw: entry,
  };
}

export function parseJsonLdListings(page: PageRecord, lane: SearchLane, contacts: ContactCandidate[]): ListingCandidate[] {
  const $ = cheerio.load(page.html);
  const listings: ListingCandidate[] = [];
  $("script[type='application/ld+json']").each((_, element) => {
    const raw = $(element).text().trim();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown> | Array<Record<string, unknown>>;
      const graphEntries =
        !Array.isArray(parsed) &&
        typeof parsed === "object" &&
        parsed !== null &&
        Array.isArray((parsed as { "@graph"?: unknown })["@graph"])
          ? (((parsed as { "@graph"?: Array<Record<string, unknown>> })["@graph"] ?? []) as Array<Record<string, unknown>>)
          : null;
      const entries = Array.isArray(parsed)
        ? parsed
        : graphEntries
          ? graphEntries
          : [parsed];
      for (const entry of entries) {
        if (String(entry["@type"] ?? "") !== "JobPosting") continue;
        listings.push(listingFromStructuredEntry(entry, page, lane, contacts));
      }
    } catch {
      // Ignore malformed JSON-LD.
    }
  });
  return listings;
}

export function parseCareerHub(page: PageRecord, lane: SearchLane): string[] {
  const $ = cheerio.load(page.html);
  const jobUrls = new Set<string>();
  const pageDomain = domainFromUrl(page.url);
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href") ?? "";
    const text = $(element).text().trim();
    if (!/(job|career|role|apply|designer|engineer|product|developer|architect|manager|intern)/i.test(`${href} ${text}`)) return;
    const resolved = new URL(href, page.url).toString();
    const resolvedDomain = domainFromUrl(resolved);
    if (resolvedDomain && pageDomain && resolvedDomain !== pageDomain) return;
    if (/(about|team|contact|press|blog|culture|privacy|legal|imprint)/i.test(resolved)) return;
    if (/(about|team|contact|press|blog|culture|privacy|legal|imprint)/i.test(text)) return;
    jobUrls.add(resolved);
  });
  return [...jobUrls].filter((url) => url !== page.url).slice(0, 30);
}

export function parseGenericListing(page: PageRecord, lane: SearchLane, contacts: ContactCandidate[]): ListingCandidate[] {
  const title = page.title || "Untitled role";
  const company = page.domain || "Unknown";
  const text = page.text;
  return [
    {
      lane,
      externalId: page.normalizedUrl,
      title,
      titleFamily: "",
      company,
      location: /berlin/i.test(text) ? "Berlin" : "",
      country: /germany|deutschland/i.test(text) ? "Germany" : "",
      language: /\b(deutsch|german)\b/i.test(text) ? "de" : "en",
      workModel: inferWorkModel(text),
      employmentType: /(full[- ]time)/i.test(text) ? "full-time" : "",
      salary: "",
      description: summarizeToLine(text, 1200),
      url: page.url,
      applyUrl: page.url,
      source: page.provider,
      sourceType: page.sourceType,
      sourceUrls: [page.url],
      companyUrl: page.domain ? `https://${page.domain}` : "",
      careersUrl: page.pageType === "career_hub" ? page.url : "",
      aboutUrl: "",
      teamUrl: "",
      contactUrl: "",
      pressUrl: "",
      companyLinkedinUrl: contacts.find((contact) => contact.kind === "linkedin_company")?.linkedinUrl ?? "",
      publicContacts: contacts,
      postedAt: "",
      validThrough: "",
      department: "",
      experienceYearsText: extractYearRequirement(text),
      remoteScope: "",
      applicantLocationRequirements: [],
      applicationContactName: "",
      applicationContactEmail: contacts.find((contact) => contact.kind === "application_email")?.email ?? "",
      parseConfidence: 0.45,
      sourceConfidence: 0.4,
      isRealJobPage: page.pageType === "job_detail",
      raw: {},
    },
  ];
}
