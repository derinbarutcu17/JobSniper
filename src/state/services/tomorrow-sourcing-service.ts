import fs from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";
import * as cheerio from "cheerio";
import { loadConfig } from "../../normalization/config.js";
import {
  buildApplicationReasons,
  buildOutreachReasons,
  dedupeApplications,
  exclusionRecord,
  inferUrgency,
  isBerlinRelevant,
  normalizeCompanyToken,
  normalizeDomain,
  rankApplications,
  rankOutreach,
  resolveContactConfidence,
  scoreApplicationFit,
  shouldExcludeOutreachCandidate,
} from "../../normalization/tomorrow-sourcing.js";
import { resolveCompanyBestContact } from "../../ingestion/company-enrich.js";
import { buildCompanyOutreachSnapshots } from "../outreach-state.js";
import { openDatabase } from "../db.js";
import type {
  CompanyOutreachSnapshot,
  TomorrowApplicationTarget,
  TomorrowCompanyOutreachTarget,
  TomorrowCuratedCompany,
  TomorrowExclusionRecord,
  TomorrowProfileSignals,
  TomorrowSourcingGmailMatch,
  TomorrowSourcingOptions,
  TomorrowSourcingReport,
  TomorrowSourcingResult,
} from "../../types.js";

type JsonRecord = Record<string, unknown>;

type ContactSeedFile = {
  source?: string;
  generatedAt?: string;
  companies?: string[];
};

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

type AshbyPosting = {
  id: string;
  title: string;
  locationName?: string | null;
  workplaceType?: string | null;
  publishedDate?: string | null;
  employmentType?: string | null;
};

type GmailAudit = {
  available: boolean;
  mode: "unavailable" | "connector_available" | "imported_snapshot";
  reason: string;
  matches: TomorrowSourcingGmailMatch[];
};

type GmailSearchTarget = {
  company: string;
  value: string;
  confidence: "high" | "medium" | "low";
  source: string;
};

type InvalidContactRoutesFile = {
  routes?: string[];
};

function safeString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function safeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function unwrapDuckDuckGoResult(url: string): string {
  try {
    const parsed = new URL(url, "https://duckduckgo.com");
    return parsed.searchParams.get("uddg") || url;
  } catch {
    return url;
  }
}

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "user-agent": "Mozilla/5.0" },
  });
  if (!response.ok) return [];
  const html = await response.text();
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];
  $(".result").each((_, element) => {
    const anchor = $(element).find(".result__title a").first();
    const title = anchor.text().trim();
    const href = unwrapDuckDuckGoResult(anchor.attr("href") || "");
    const snippet = $(element).find(".result__snippet").text().trim();
    if (!title || !href) return;
    results.push({ title, url: href, snippet });
  });
  return results;
}

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, redirect: "follow" });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  return response.text();
}

function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  return $("body").text().replace(/\s+/g, " ").trim();
}

function parseAshbyPostings(html: string): AshbyPosting[] {
  const start = html.indexOf("\"jobPostings\":");
  if (start < 0) return [];
  const bracketStart = html.indexOf("[", start);
  if (bracketStart < 0) return [];
  let depth = 0;
  let end = -1;
  for (let index = bracketStart; index < html.length; index += 1) {
    const char = html[index];
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  if (end < 0) return [];
  try {
    return JSON.parse(html.slice(bracketStart, end + 1)) as AshbyPosting[];
  } catch {
    return [];
  }
}

function ashbyBoardSlug(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\/+|\/+$/g, "").split("/")[0] || "";
  } catch {
    return "";
  }
}

function applicationTrust(url: string): number {
  const lower = url.toLowerCase();
  if (/jobs\.ashbyhq\.com|lever\.co|greenhouse\.io/.test(lower)) return 1;
  if (/company|careers|jobs/.test(lower)) return 0.8;
  if (/linkedin|wellfound|indeed|glassdoor/.test(lower)) return 0.5;
  return 0.6;
}

function isApplicationUrlLikelyUseful(url: string): boolean {
  const lower = url.toLowerCase();
  if (!/^https?:\/\//.test(lower)) return false;
  if (/linkedin\.com\/jobs\/search|glassdoor|indeed|join\.com\/companies\/|jobstacky/.test(lower)) return false;
  return /jobs|careers|ashby|lever|greenhouse|startupjobs|berlinstartupjobs/.test(lower);
}

function isSpecificRolePage(input: { url: string; title: string; snippet?: string; text?: string }): boolean {
  const lowerUrl = input.url.toLowerCase();
  const lowerTitle = input.title.toLowerCase();
  const lowerSnippet = (input.snippet || "").toLowerCase();
  const lowerText = (input.text || "").toLowerCase();
  const combined = `${lowerTitle} ${lowerSnippet} ${lowerText}`;
  const parsedPath = (() => {
    try {
      return new URL(input.url).pathname.toLowerCase().replace(/\/+$/, "") || "/";
    } catch {
      return "";
    }
  })();

  if (
    /jobs\/search|\/jobs\/?$|stellenangebote|english-speaking jobs|mehr als [0-9]|[0-9]+\s+jobs?\b|[0-9]+\s+stellenangebote|jobijoba|stepstone|xing\.com\/jobs\/|linkedin\.com\/jobs\/[^/]*jobs-/.test(
      `${lowerUrl} ${combined}`,
    )
  ) {
    return false;
  }

  if (/design engineer jobs in berlin|frontend jobs in berlin|product designer jobs in berlin/.test(combined)) {
    return false;
  }
  if (/^careers?\s+at\b|^jobs?\s+at\b|join our team|open positions|careers homepage|job opportunities at|jobs and impact careers/.test(lowerTitle)) {
    return false;
  }
  if (/\bcareers?\b/.test(lowerTitle) && !/\b(design|designer|engineer|engineering|frontend|product|developer|full stack|full-stack|ux|ui)\b/.test(lowerTitle)) {
    return false;
  }
  if (["/careers", "/jobs", "/careers/", "/jobs/"].includes(parsedPath)) {
    return false;
  }

  const boardSpecificRole =
    /jobs\.ashbyhq\.com\/[^/]+\/[^/?#]+/.test(lowerUrl) ||
    /lever\.co\/[^/]+\/[a-z0-9-]{6,}/.test(lowerUrl) ||
    /greenhouse\.io\/[a-z0-9-]+\/jobs\/[0-9]+/.test(lowerUrl) ||
    /linkedin\.com\/jobs\/view\//.test(lowerUrl) ||
    /berlinstartupjobs\.com\/.+\/.+/.test(lowerUrl) ||
    /startup\.jobs\/.+\/[0-9]+/.test(lowerUrl);

  const textSignals = /\b(apply|apply now|responsibilities|requirements|about the role|what you will do|your mission)\b/.test(combined);
  return boardSpecificRole || textSignals;
}

function isStaleRolePage(text: string): boolean {
  return /\bthis job is no longer available\b|position has been filled|role is closed|job expired/i.test(text);
}

function companyFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "");
    return hostname.split(".")[0] || hostname;
  } catch {
    return "";
  }
}

function companyFromPageTitle(title: string, url: string): string {
  const clean = title.trim();
  const linkedInMatch = clean.match(/^(.+?)\s+sucht\s+/i);
  if (linkedInMatch?.[1]) return linkedInMatch[1].trim();
  const atMatch = clean.match(/@\s*([^|]+)/);
  if (atMatch?.[1]) return atMatch[1].trim();
  const dashParts = clean.split("|").map((part) => part.trim()).filter(Boolean);
  if (dashParts.length > 1 && /career|jobs|careers|job/i.test(dashParts[1] || "")) {
    return dashParts[0] || companyFromUrl(url);
  }
  return companyFromUrl(url);
}

function roleFromPageTitle(title: string): string {
  const clean = title.trim();
  const germanMatch = clean.match(/^.+?\s+sucht\s+(.+?)\s+in\s+berlin$/i);
  if (germanMatch?.[1]) return germanMatch[1].trim();
  const germanLooseMatch = clean.match(/^.+?\s+sucht\s+(.+)$/i);
  if (germanLooseMatch?.[1]) return germanLooseMatch[1].trim();
  return clean.replace(/\|.*$/, "").replace(/\s*@.*$/, "").trim();
}

function loadProfile(baseDir: string): TomorrowProfileSignals {
  const profilePath = path.join(baseDir, "profile", "profile.json");
  const profile = readJsonFile<JsonRecord>(profilePath, {});
  const toolSignals = Array.isArray(profile.toolSignals) ? profile.toolSignals.map((entry: unknown) => safeString(entry).toLowerCase()) : [];
  return {
    summary: safeString(profile.summary),
    toolSignals,
    preferredLocations: Array.isArray(profile.preferredLocations) ? profile.preferredLocations.map((entry: unknown) => safeString(entry)) : ["Berlin"],
    targetSeniority: safeString(profile.targetSeniority) || "junior",
  };
}

function loadSeedCompanies(baseDir: string): Set<string> {
  return new Set(loadSeedCompanyValues(baseDir).map((entry) => normalizeCompanyToken(entry)));
}

function loadSeedCompanyValues(baseDir: string): string[] {
  const seedPath = path.join(baseDir, "data", "contacted-company-seed.json");
  const data = readJsonFile<ContactSeedFile>(seedPath, { companies: [] });
  return (data.companies || []).map((entry) => safeString(entry).trim()).filter((entry) => entry.length > 0);
}

function workspaceRootFromBaseDir(baseDir: string): string {
  return path.resolve(baseDir, "..");
}

function parseBulletCompany(line: string): string {
  return line
    .replace(/^\s*-\s*/, "")
    .replace(/\s+-\s+`.*$/, "")
    .trim();
}

function loadManualContactHistory(baseDir: string): Set<string> {
  const workspaceRoot = workspaceRootFromBaseDir(baseDir);
  const files = [
    { path: path.join(workspaceRoot, "memory", "sent-emails.md"), section: "## Applied / Already Reached" },
    { path: path.join(workspaceRoot, "memory", "job-search-source-of-truth.md"), section: "## Already Applied / Contacted" },
  ];
  const values = new Set<string>();
  for (const item of files) {
    if (!fs.existsSync(item.path)) continue;
    const lines = fs.readFileSync(item.path, "utf8").split(/\r?\n/);
    let inSection = false;
    for (const line of lines) {
      if (line.startsWith("## ")) {
        inSection = line.trim() === item.section;
        continue;
      }
      if (!inSection) continue;
      if (!line.trim().startsWith("- ")) continue;
      const company = parseBulletCompany(line);
      if (company) values.add(normalizeCompanyToken(company));
    }
  }
  return values;
}

function loadInvalidContactRoutes(baseDir: string): Set<string> {
  const data = readJsonFile<InvalidContactRoutesFile>(path.join(baseDir, "data", "invalid-contact-routes.json"), { routes: [] });
  return new Set((data.routes || []).map((entry) => safeString(entry).trim().toLowerCase()).filter(Boolean));
}

function confidenceWeight(value: "high" | "medium" | "low"): number {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
}

function normalizeSearchTargetValue(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/[\\"]/g, "")
    .replace(/\/.*$/, "")
    .trim();
}

function addSearchTarget(targets: Map<string, GmailSearchTarget>, target: GmailSearchTarget): void {
  const normalized = normalizeCompanyToken(target.value) || normalizeSearchTargetValue(target.value).toLowerCase();
  if (!normalized) return;
  const existing = targets.get(normalized);
  if (!existing || confidenceWeight(target.confidence) > confidenceWeight(existing.confidence)) {
    targets.set(normalized, { ...target, value: normalizeSearchTargetValue(target.value) });
  }
}

export function buildGmailSearchTargets(baseDir: string): GmailSearchTarget[] {
  const { db } = openDatabase(baseDir);
  const targets = new Map<string, GmailSearchTarget>();
  const seedCompanies = loadSeedCompanyValues(baseDir);

  for (const company of seedCompanies) {
    addSearchTarget(targets, {
      company,
      value: company,
      confidence: "medium",
      source: "seed_list",
    });
  }

  const companyRows = db
    .prepare(
      `
      SELECT name, domain, company_url, careers_url, contact_url
      FROM companies
      ORDER BY updated_at DESC
    `,
    )
    .all() as JsonRecord[];
  for (const row of companyRows) {
    const company = safeString(row.name);
    if (company) {
      addSearchTarget(targets, {
        company,
        value: company,
        confidence: "medium",
        source: "company_name",
      });
    }
    for (const value of [row.domain, row.company_url, row.careers_url, row.contact_url]) {
      const normalized = normalizeDomain(safeString(value));
      if (!normalized) continue;
      addSearchTarget(targets, {
        company: company || normalized,
        value: normalized,
        confidence: "high",
        source: "company_domain",
      });
    }
  }

  const contactRows = db
    .prepare(
      `
      SELECT c.email, co.name AS company_name
      FROM contacts c
      LEFT JOIN companies co ON co.id = c.company_id
      WHERE c.email != ''
      ORDER BY c.updated_at DESC
    `,
    )
    .all() as JsonRecord[];
  for (const row of contactRows) {
    const email = safeString(row.email);
    if (!email) continue;
    addSearchTarget(targets, {
      company: safeString(row.company_name) || email,
      value: email,
      confidence: "high",
      source: "contact_email",
    });
  }

  return [...targets.values()];
}

function loadGmailSnapshot(baseDir: string): TomorrowSourcingGmailMatch[] {
  const snapshotPath = path.join(baseDir, "data", "gmail-sent-snapshot.json");
  const raw = readJsonFile<{ matches?: TomorrowSourcingGmailMatch[] }>(snapshotPath, { matches: [] });
  return Array.isArray(raw.matches) ? raw.matches : [];
}

async function auditGmailSent(baseDir: string, targets: GmailSearchTarget[]): Promise<GmailAudit> {
  const snapshotMatches = loadGmailSnapshot(baseDir);
  if (snapshotMatches.length > 0) {
    const targetKeys = new Set(targets.flatMap((target) => [normalizeCompanyToken(target.company), normalizeDomain(target.value)]));
    const matches = snapshotMatches.filter((match) => {
      const companyKey = normalizeCompanyToken(match.company);
      const valueKey = normalizeDomain(match.matchedValue);
      return targetKeys.has(companyKey) || (valueKey && targetKeys.has(valueKey));
    });
    return {
      available: true,
      mode: "imported_snapshot",
      reason: "using imported Gmail sent snapshot",
      matches,
    };
  }
  if (process.env.SNIPER_GMAIL_CONNECTOR_AVAILABLE === "1") {
    return {
      available: false,
      mode: "connector_available",
      reason: "Gmail connector available but not wired in this command path",
      matches: [],
    };
  }
  return {
    available: false,
    mode: "unavailable",
    reason: "Gmail sent audit unavailable; using DB + seed + manual sent history only",
    matches: [],
  };
}

async function assessContactRoute(baseDir: string, companyName: string, companyUrl: string, route: string): Promise<"verified" | "weak" | "invalid"> {
  const invalidRoutes = loadInvalidContactRoutes(baseDir);
  const normalizedRoute = route.trim().toLowerCase();
  if (!normalizedRoute) return "invalid";
  if (invalidRoutes.has(normalizedRoute)) return "invalid";

  const emailMatch = normalizedRoute.match(/^[^@\s]+@([^@\s]+)$/);
  const routeDomain = emailMatch ? emailMatch[1] : normalizeDomain(normalizedRoute);
  if (routeDomain) {
    try {
      await dns.lookup(routeDomain);
    } catch {
      return "invalid";
    }
  }

  const homepage = companyUrl || (route.startsWith("http") ? route : "");
  if (!homepage) return emailMatch ? "verified" : "weak";
  try {
    const html = await fetchHtml(homepage);
    const title = ((html.match(/<title[^>]*>([^<]+)/i) || [])[1] || "").trim().toLowerCase();
    const text = htmlToText(html).slice(0, 1200).toLowerCase();
    if (/rtp slot|jackpot|gacor|casino|betting|gambling/.test(`${title} ${text}`)) return "invalid";
    if (!title && text.length < 50) return "weak";
    const normalizedCompany = normalizeCompanyToken(companyName);
    const pageSignals = `${title} ${text}`;
    if (normalizedCompany && !pageSignals.includes(normalizedCompany.split(" ")[0] || "")) {
      return "weak";
    }
    return "verified";
  } catch {
    return emailMatch ? "weak" : "invalid";
  }
}

async function discoverAshbyApplications(profile: TomorrowProfileSignals, queries: string[]): Promise<TomorrowApplicationTarget[]> {

  const boardUrls = new Set<string>();
  for (const query of queries) {
    const results = await searchDuckDuckGo(query);
    for (const result of results) {
      if (!result.url.includes("jobs.ashbyhq.com")) continue;
      const parsed = new URL(result.url);
      const parts = parsed.pathname.replace(/^\/+|\/+$/g, "").split("/");
      const board = `https://jobs.ashbyhq.com/${parts[0]}`;
      boardUrls.add(board);
      if (parts.length > 1 && isApplicationUrlLikelyUseful(result.url)) {
        boardUrls.add(result.url);
      }
    }
  }

  const output: TomorrowApplicationTarget[] = [];
  for (const url of boardUrls) {
    const parts = new URL(url).pathname.replace(/^\/+|\/+$/g, "").split("/");
    if (parts.length > 1) {
      const html = await fetchHtml(url).catch(() => "");
      if (!html) continue;
      const title = cheerio.load(html)("title").text().trim() || parts[1];
      const text = htmlToText(html);
      if (isStaleRolePage(text)) continue;
      const company = title.split("@").pop()?.split("|")[0]?.trim() || companyFromUrl(url);
      const location = /berlin/i.test(text) ? "Berlin" : /germany/i.test(text) ? "Germany" : "";
      const score = scoreApplicationFit({ title, location, text, sourceTrust: applicationTrust(url), profile });
      if (score < 25) continue;
      output.push({
        company,
        role: roleFromPageTitle(title),
        whyItFits: buildApplicationReasons({ title, text, location, profile }).join("; "),
        applicationLink: url,
        urgency: inferUrgency(text),
        confidence: applicationTrust(url) >= 0.8 ? "high" : "medium",
        whyItBeatAlternatives: "direct role page with strong design/product overlap",
        source: "ashby",
        score,
        evidence: [{ label: "Role page", value: url }],
        nextAction: "Apply on the live role page tomorrow with a tailored note.",
      });
      continue;
    }

    const html = await fetchHtml(url).catch(() => "");
    if (!html) continue;
    const postings = parseAshbyPostings(html);
    const boardSlug = ashbyBoardSlug(url);
    for (const posting of postings) {
      const location = safeString(posting.locationName);
      const title = safeString(posting.title);
      if (!title || !isBerlinRelevant(location, `${location} ${safeString(posting.workplaceType)}`)) continue;
      const text = `${title} ${location} ${safeString(posting.workplaceType)} ${safeString(posting.employmentType)}`;
      const directUrl = `https://jobs.ashbyhq.com/${boardSlug}/${posting.id}`;
      const score = scoreApplicationFit({ title, location, text, sourceTrust: 1, publishedDate: safeString(posting.publishedDate), profile });
      if (score < 25) continue;
      output.push({
        company: boardSlug,
        role: title,
        whyItFits: buildApplicationReasons({ title, text, location, profile }).join("; "),
        applicationLink: directUrl,
        urgency: inferUrgency(text, safeString(posting.publishedDate)),
        confidence: "high",
        whyItBeatAlternatives: "structured Ashby job board listing with Berlin location",
        source: "ashby",
        score,
        evidence: [{ label: "Ashby board", value: url }, { label: "Direct role page", value: directUrl }],
        nextAction: "Open the direct Ashby role page and apply tomorrow.",
      });
    }
  }
  return output;
}

async function discoverSearchApplications(profile: TomorrowProfileSignals, queries: string[]): Promise<TomorrowApplicationTarget[]> {
  const candidates: TomorrowApplicationTarget[] = [];
  for (const query of queries) {
    const results = await searchDuckDuckGo(query);
    for (const result of results.slice(0, 8)) {
      if (!isApplicationUrlLikelyUseful(result.url)) continue;
      if (/openai|glassdoor|indeed|linkedin\.com\/jobs\/search/.test(result.url.toLowerCase())) continue;
      const html = await fetchHtml(result.url).catch(() => "");
      if (!html) continue;
      const pageTitle = cheerio.load(html)("title").text().trim() || result.title;
      const text = htmlToText(html);
      if (isStaleRolePage(text)) continue;
      if (!isSpecificRolePage({ url: result.url, title: pageTitle, snippet: result.snippet, text })) continue;
      const location = /berlin/i.test(`${result.snippet} ${text}`) ? "Berlin" : /germany/i.test(`${result.snippet} ${text}`) ? "Germany" : "";
      const company = companyFromPageTitle(pageTitle, result.url);
      const score = scoreApplicationFit({ title: pageTitle, location, text: `${result.snippet} ${text}`, sourceTrust: applicationTrust(result.url), profile });
      if (score < 28) continue;
      candidates.push({
        company,
        role: roleFromPageTitle(pageTitle),
        whyItFits: buildApplicationReasons({ title: pageTitle, text: `${result.snippet} ${text}`, location, profile }).join("; "),
        applicationLink: result.url,
        urgency: inferUrgency(`${result.snippet} ${text}`),
        confidence: applicationTrust(result.url) >= 0.8 ? "high" : "medium",
        whyItBeatAlternatives: "live role page survived fit and trust filters",
        source: "web_search",
        score,
        evidence: [{ label: "Search query", value: query }, { label: "Role page", value: result.url }],
        nextAction: "Review the role page and apply tomorrow if the brief still holds.",
      });
    }
  }
  return candidates;
}

async function discoverDbCareersApplications(baseDir: string, profile: TomorrowProfileSignals): Promise<TomorrowApplicationTarget[]> {
  const { db } = openDatabase(baseDir);
  const rows = db.prepare(`
    SELECT name, careers_url, company_url
    FROM companies
    WHERE careers_url != ''
    ORDER BY startup_score DESC, updated_at DESC
  `).all() as JsonRecord[];
  const output: TomorrowApplicationTarget[] = [];
  for (const row of rows) {
    const company = safeString(row.name);
    const careersUrl = safeString(row.careers_url);
    if (!careersUrl) continue;
    if (/jobs\.ashbyhq\.com/.test(careersUrl)) {
      const html = await fetchHtml(careersUrl).catch(() => "");
      if (!html) continue;
      const boardSlug = ashbyBoardSlug(careersUrl);
      const postings = parseAshbyPostings(html);
      for (const posting of postings) {
        const title = safeString(posting.title);
        const location = safeString(posting.locationName);
        const text = `${title} ${location} ${safeString(posting.workplaceType)} ${safeString(posting.employmentType)}`;
        const score = scoreApplicationFit({ title, location, text, sourceTrust: 1, publishedDate: safeString(posting.publishedDate), profile });
        if (score < 24) continue;
        output.push({
          company,
          role: title,
          whyItFits: buildApplicationReasons({ title, text, location, profile }).join("; "),
          applicationLink: `https://jobs.ashbyhq.com/${boardSlug}/${posting.id}`,
          urgency: inferUrgency(text, safeString(posting.publishedDate)),
          confidence: "high",
          whyItBeatAlternatives: "direct careers board from existing tracked company",
          source: "company_careers_ashby",
          score,
          evidence: [{ label: "Careers board", value: careersUrl }],
          nextAction: "Open the direct careers role page and apply tomorrow.",
        });
      }
      continue;
    }

      if (/startup\.jobs|join\.com|careers|jobs/.test(careersUrl)) {
      const html = await fetchHtml(careersUrl).catch(() => "");
      if (!html) continue;
      const title = cheerio.load(html)("title").text().trim();
      const text = htmlToText(html);
      if (isStaleRolePage(text)) continue;
      if (!isSpecificRolePage({ url: careersUrl, title, text })) continue;
      const location = /berlin/i.test(text) ? "Berlin" : /germany/i.test(text) ? "Germany" : "";
      const score = scoreApplicationFit({ title, location, text, sourceTrust: applicationTrust(careersUrl), profile });
      if (score < 24) continue;
      output.push({
        company,
        role: roleFromPageTitle(title),
        whyItFits: buildApplicationReasons({ title, text, location, profile }).join("; "),
        applicationLink: careersUrl,
        urgency: inferUrgency(text),
        confidence: applicationTrust(careersUrl) >= 0.8 ? "high" : "medium",
        whyItBeatAlternatives: "direct careers or role page already tracked in Job Sniper",
        source: "company_careers_page",
        score,
        evidence: [{ label: "Careers URL", value: careersUrl }, ...(safeString(row.company_url) ? [{ label: "Company URL", value: safeString(row.company_url) }] : [])],
        nextAction: "Open the tracked careers page and apply tomorrow.",
      });
    }
  }
  return output;
}

async function discoverCuratedApplications(profile: TomorrowProfileSignals, curatedQueries: TomorrowCuratedCompany[]): Promise<TomorrowApplicationTarget[]> {
  const output: TomorrowApplicationTarget[] = [];
  for (const item of curatedQueries) {
    const results = await searchDuckDuckGo(item.query);
    for (const hit of results.filter((result) => isApplicationUrlLikelyUseful(result.url)).slice(0, 5)) {
      const html = await fetchHtml(hit.url).catch(() => "");
      if (!html) continue;
      const pageTitle = cheerio.load(html)("title").text().trim() || hit.title;
      const text = `${hit.snippet} ${htmlToText(html)}`;
      if (isStaleRolePage(text)) continue;
      if (!isSpecificRolePage({ url: hit.url, title: pageTitle, snippet: hit.snippet, text })) continue;
      const location = /berlin/i.test(text) ? "Berlin" : /germany|europe/.test(text) ? "Germany" : "";
      const title = pageTitle || item.roleHint;
      const score = scoreApplicationFit({ title, location, text, sourceTrust: applicationTrust(hit.url), profile });
      if (score < 22) continue;
      output.push({
        company: item.company,
        role: roleFromPageTitle(title),
        whyItFits: buildApplicationReasons({ title, text, location, profile }).join("; "),
        applicationLink: hit.url,
        urgency: inferUrgency(text),
        confidence: applicationTrust(hit.url) >= 0.8 ? "high" : "medium",
        whyItBeatAlternatives: "curated high-fit target query returned a live role page",
        source: "curated_query",
        score,
        evidence: [{ label: "Search query", value: item.query }, { label: "Role page", value: hit.url }],
        nextAction: "Open the role page and apply tomorrow with a tailored note.",
      });
      break;
    }
  }
  return output;
}

function buildDbExclusionSets(baseDir: string): { dbMatches: Set<string>; snapshots: CompanyOutreachSnapshot[] } {
  const { db } = openDatabase(baseDir);
  const snapshots = buildCompanyOutreachSnapshots(db);
  const dbMatches = new Set<string>();
  for (const snapshot of snapshots) {
    if (snapshot.status === "new") continue;
    dbMatches.add(normalizeCompanyToken(snapshot.companyName));
  }
  const jobRows = db
    .prepare("SELECT c.name AS company_name, c.domain AS company_domain FROM jobs j LEFT JOIN companies c ON c.id = j.company_id WHERE j.status IN ('applied','contacted','reply_received','interviewing','rejected','archived')")
    .all() as JsonRecord[];
  for (const row of jobRows) {
    dbMatches.add(normalizeCompanyToken(safeString(row.company_name)));
    const domain = normalizeDomain(safeString(row.company_domain));
    if (domain) dbMatches.add(domain);
  }
  return { dbMatches, snapshots };
}

function buildApplicationExclusionSet(baseDir: string): Set<string> {
  const values = new Set<string>();
  for (const value of loadSeedCompanies(baseDir)) values.add(value);
  for (const value of loadManualContactHistory(baseDir)) values.add(value);
  for (const value of buildDbExclusionSets(baseDir).dbMatches) {
    if (!value.includes(".")) values.add(value);
  }
  return values;
}

function pickAddressLabel(emailOrRoute: string): string {
  const value = emailOrRoute.toLowerCase();
  if (value.includes("jobs@") || value.includes("career")) return "Hiring team";
  if (value.includes("founder")) return "Founders";
  if (value.includes("hello@") || value.includes("info@") || value.includes("contact@")) return "Team";
  if (/https?:\/\//.test(value)) return "Team";
  return "Team";
}

function prioritizeApplications(items: TomorrowApplicationTarget[]): TomorrowApplicationTarget[] {
  const preferredOrder = ["langdock", "kombo", "andwhy"];
  const normalized = (value: string) => normalizeCompanyToken(value).replace(/\s+/g, "");
  return [...items].sort((left, right) => {
    const leftIndex = preferredOrder.indexOf(normalized(left.company));
    const rightIndex = preferredOrder.indexOf(normalized(right.company));
    const leftRank = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const rightRank = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return right.score - left.score;
  });
}

async function buildOutreachCandidates(baseDir: string, seedMatches: Set<string>, dbMatches: Set<string>, gmailHighMatches: Set<string>, gmailMediumMatches: Set<string>): Promise<{ items: TomorrowCompanyOutreachTarget[]; excluded: TomorrowExclusionRecord[] }> {
  const { db } = openDatabase(baseDir);
  const rows = db.prepare(`
    SELECT
      id,
      name,
      domain,
      startup_score,
      recommendation,
      best_route,
      pitch_theme,
      direct_contact_count,
      reachable_now,
      priority_band,
      company_url,
      careers_url,
      contact_url,
      linkedin_url,
      updated_at,
      location
    FROM companies
    ORDER BY startup_score DESC, updated_at DESC
  `).all() as JsonRecord[];
  const bestContactsByCompany = new Map<number, string>();
  const bestContactRows = db.prepare(`
    SELECT company_id, email
    FROM contacts
    WHERE email != ''
    ORDER BY
      CASE
        WHEN email LIKE 'jobs@%' OR email LIKE 'careers@%' OR email LIKE 'career@%' OR email LIKE 'talent@%' OR email LIKE 'hiring@%' THEN 3
        WHEN email LIKE 'hello@%' OR email LIKE 'info@%' OR email LIKE 'contact@%' THEN 2
        ELSE 1
      END DESC,
      confidence DESC,
      updated_at DESC
  `).all() as JsonRecord[];
  for (const row of bestContactRows) {
    const companyId = safeNumber(row.company_id);
    if (companyId > 0 && !bestContactsByCompany.has(companyId)) {
      bestContactsByCompany.set(companyId, safeString(row.email));
    }
  }

  const items: TomorrowCompanyOutreachTarget[] = [];
  const excluded: TomorrowExclusionRecord[] = [];
  for (const row of rows) {
    const companyName = safeString(row.name);
    const domain = safeString(row.domain);
    const exclusion = shouldExcludeOutreachCandidate({ companyName, domain, seedMatches, dbMatches, gmailHighMatches, gmailMediumMatches });
    if (exclusion.excluded) {
      excluded.push(exclusionRecord(companyName, exclusion.reason || "excluded"));
      continue;
    }
      const route = safeString(row.best_route);
    const startupScore = safeNumber(row.startup_score);
    const directContactCount = safeNumber(row.direct_contact_count);
    const reachableNow = safeNumber(row.reachable_now) === 1;
    const bestContact = bestContactsByCompany.get(safeNumber(row.id)) || resolveCompanyBestContact(row) || safeString(row.contact_url) || safeString(row.careers_url);
    if (!reachableNow || !bestContact || startupScore < 12) {
      excluded.push(exclusionRecord(companyName, "not reachable enough for tomorrow outreach"));
      continue;
    }
    const contact = {
      kind: /@/.test(bestContact) ? "email" : /contact|imprint/.test(bestContact) ? "contact_page" : "website",
      value: bestContact,
    };
    const contactStatus = await assessContactRoute(baseDir, companyName, safeString(row.company_url), bestContact);
    if (contactStatus === "invalid") {
      excluded.push(exclusionRecord(companyName, "contact route failed revalidation"));
      continue;
    }
    const reasons = buildOutreachReasons({ pitchTheme: safeString(row.pitch_theme), route, startupScore, directContactCount });
    const confidence = resolveContactConfidence(contact);
    const score = startupScore * 2 + directContactCount * 4 + (confidence === "high" ? 8 : confidence === "medium" ? 4 : 1) + (route.includes("direct_email") ? 6 : route.includes("founder") ? 5 : 0) + (contactStatus === "verified" ? 6 : 2);
    const routeLabel = /@/.test(bestContact) ? bestContact : safeString(row.contact_url) || safeString(row.careers_url) || bestContact;
    items.push({
      company: companyName,
      whyItFits: reasons.join("; "),
      targetType: pickAddressLabel(routeLabel),
      contactRoute: routeLabel,
      whoToAddress: pickAddressLabel(routeLabel),
      contactConfidence: confidence,
      contactStatus,
      whyItIsFresh: "no strong contact match found in DB state, Gmail Sent, or the seed exclusion list",
      nextAction: `Send a short tailored email to ${routeLabel} tomorrow.`,
      score,
      evidence: [
        { label: "Company URL", value: safeString(row.company_url) },
        ...(safeString(row.contact_url) ? [{ label: "Contact page", value: safeString(row.contact_url) }] : []),
        ...(safeString(row.careers_url) ? [{ label: "Careers page", value: safeString(row.careers_url) }] : []),
      ],
    });
  }
  return { items, excluded };
}

export function createTomorrowSourcingService(baseDir: string) {
  return {
    async run(_options: TomorrowSourcingOptions = {}): Promise<TomorrowSourcingResult> {
      const profile = loadProfile(baseDir);
      const config = loadConfig(baseDir);
      const seedMatches = loadSeedCompanies(baseDir);
      const manualHistoryMatches = loadManualContactHistory(baseDir);
      const { dbMatches } = buildDbExclusionSets(baseDir);
      const gmailAudit = await auditGmailSent(baseDir, buildGmailSearchTargets(baseDir));
      const gmailHighMatches = new Set(
        gmailAudit.matches.filter((match) => match.confidence === "high").flatMap((match) => [normalizeCompanyToken(match.company), normalizeDomain(match.matchedValue)]),
      );
      const gmailMediumMatches = new Set(
        gmailAudit.matches.filter((match) => match.confidence === "medium").flatMap((match) => [normalizeCompanyToken(match.company), normalizeDomain(match.matchedValue)]),
      );
      const applicationExclusions = buildApplicationExclusionSet(baseDir);

      const [ashbyApplications, searchApplications, dbCareersApplications, curatedApplications] = await Promise.all([
        discoverAshbyApplications(profile, config.tomorrow.ashbyQueries),
        discoverSearchApplications(profile, config.tomorrow.searchQueries),
        discoverDbCareersApplications(baseDir, profile),
        discoverCuratedApplications(profile, config.tomorrow.curatedCompanies),
      ]);

      const dbJobs = openDatabase(baseDir).db.prepare(`
        SELECT j.id, j.title, j.location, j.url, j.apply_url, j.source, j.status, j.pipeline_status, c.name AS company_name
        FROM jobs j
        LEFT JOIN companies c ON c.id = j.company_id
        WHERE j.recommendation = 'apply_now'
      `).all() as JsonRecord[];

      const dbApplications = dbJobs
        .map((row): TomorrowApplicationTarget | null => {
          const title = safeString(row.title);
          const location = safeString(row.location);
          const pipelineStatus = safeString(row.pipeline_status);
          if (pipelineStatus === "rejected" || pipelineStatus === "archived") return null;
          const roleText = `${title} ${location} ${safeString(row.source)}`;
          const score = scoreApplicationFit({ title, location, text: roleText, sourceTrust: 0.7, profile });
          if (score < 20) return null;
          const link = safeString(row.apply_url) || safeString(row.url);
          return {
            company: safeString(row.company_name) || "Unknown",
            role: title,
            whyItFits: buildApplicationReasons({ title, text: roleText, location, profile }).join("; "),
            applicationLink: link,
            urgency: "medium" as const,
            confidence: "medium" as const,
            whyItBeatAlternatives: "already in Job Sniper as apply_now",
            source: `job_sniper:${safeString(row.source)}`,
            score,
            evidence: link ? [{ label: "Tracked role", value: link }] : [],
            nextAction: "Open the tracked role page and apply tomorrow.",
          };
        })
        .filter((item): item is TomorrowApplicationTarget => item !== null && Boolean(item.applicationLink));

      const applications = dedupeApplications([
        ...ashbyApplications,
        ...searchApplications,
        ...dbCareersApplications,
        ...curatedApplications,
        ...dbApplications,
      ]).filter((item) => !applicationExclusions.has(normalizeCompanyToken(item.company)));

      const contactedExclusions: TomorrowExclusionRecord[] = [];
      for (const value of seedMatches) {
        contactedExclusions.push(exclusionRecord(value, "present in prior-contact seed list"));
      }
      for (const value of manualHistoryMatches) {
        contactedExclusions.push(exclusionRecord(value, "present in manual sent-history files"));
      }
      for (const value of dbMatches) {
        if (value.includes(".") || value.length < 2) continue;
        contactedExclusions.push(exclusionRecord(value, "present in Job Sniper contacted/applied state"));
      }
      for (const match of gmailAudit.matches) {
        contactedExclusions.push(exclusionRecord(match.company, `${match.confidence}-confidence Gmail Sent match`));
      }

      const { items: outreachItems, excluded: outreachExcluded } = await buildOutreachCandidates(
        baseDir,
        new Set([...seedMatches, ...manualHistoryMatches]),
        dbMatches,
        gmailHighMatches,
        gmailMediumMatches,
      );
      const rankedApplications = prioritizeApplications(rankApplications(applications));
      const rankedOutreach = rankOutreach(outreachItems);

      const report: TomorrowSourcingReport = {
        generatedAt: new Date().toISOString(),
        gmailAudit: {
          available: gmailAudit.available,
          mode: gmailAudit.mode,
          reason: gmailAudit.reason,
          matches: gmailAudit.matches,
        },
        dedupeSource: gmailAudit.mode === "imported_snapshot" ? "db + seed + manual history + gmail snapshot" : "db + seed + manual history",
        topApplications: rankedApplications.slice(0, 3),
        reserveApplications: rankedApplications.slice(3, 6),
        topOutreachCompanies: rankedOutreach.slice(0, 5),
        reserveOutreachCompanies: rankedOutreach.slice(5, 8),
        excludedAlreadyContacted: contactedExclusions,
        excludedNotGoodEnough: outreachExcluded,
      };

      return { report, text: "" };
    },
  };
}
