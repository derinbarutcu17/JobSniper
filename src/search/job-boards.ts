import * as cheerio from "cheerio";
import { collectQueryTerms } from "../role-packs.js";
import { decodeEntities, summarizeToLine, uniqueNonEmpty } from "../lib/text.js";
import { domainFromUrl, normalizeUrl } from "../lib/url.js";
import type { Dependencies, JobBoardSource, ListingCandidate, SearchLane, SniperConfig } from "../types.js";

function inferLanguage(text: string): string {
  return /\b(deutsch|german|werkstudent|praktikum)\b/i.test(text) ? "de" : "en";
}

function inferWorkModel(text: string): ListingCandidate["workModel"] {
  const lower = text.toLowerCase();
  if (lower.includes("remote") || lower.includes("work from home") || lower.includes("wfh")) return "remote";
  if (lower.includes("hybrid")) return "hybrid";
  if (lower.includes("onsite") || lower.includes("on-site")) return "onsite";
  return "unknown";
}

function inferEmploymentType(text: string): string {
  if (/full[- ]time|vollzeit/i.test(text)) return "full-time";
  if (/part[- ]time|teilzeit/i.test(text)) return "part-time";
  if (/intern(ship)?|praktikum/i.test(text)) return "internship";
  if (/contract|freelance/i.test(text)) return "contract";
  return "";
}

function buildSearchTerm(config: SniperConfig, source: JobBoardSource): string {
  if (source.query?.trim()) return source.query.trim();
  return collectQueryTerms(config, source.lane).slice(0, 3).join(" ").trim() || config.lanes[source.lane]?.label || source.lane;
}

function buildLinkedInUrl(query: string, location: string, maxResults: number): string {
  const params = new URLSearchParams({
    keywords: query,
    location,
    start: "0",
  });
  if (/remote/i.test(query)) {
    params.set("f_WT", "2");
  }
  params.set("position", "1");
  params.set("pageNum", "0");
  return `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${params.toString()}&count=${Math.min(maxResults, 25)}`;
}

function parseLinkedInListings(html: string, source: JobBoardSource): ListingCandidate[] {
  const $ = cheerio.load(html);
  const listings: ListingCandidate[] = [];
  $(".base-search-card").each((_, element) => {
    const anchor = $(element).find("a.base-card__full-link").first();
    const title = $(element).find("h3.base-search-card__title, span.sr-only").first().text().trim();
    const companyAnchor = $(element).find("h4.base-search-card__subtitle a").first();
    const company = companyAnchor.text().trim() || $(element).find("h4.base-search-card__subtitle").text().trim();
    const location = $(element).find(".job-search-card__location").first().text().trim();
    const listedAt = $(element).find("time").first().attr("datetime") ?? "";
    const salary = $(element).find(".job-search-card__salary-info").first().text().trim();
    const href = normalizeUrl(anchor.attr("href")?.split("?")[0] ?? "");
    if (!title || !href || !company) return;
    const snippet = summarizeToLine(
      [
        $(element).find(".job-search-card__snippet").text().trim(),
        location,
        salary,
      ].filter(Boolean).join(" • "),
      1000,
    );
    listings.push({
      lane: source.lane,
      externalId: href.split("-").pop() ?? href,
      title,
      titleFamily: "",
      company,
      location,
      country: /berlin|germany|deutschland/i.test(location) ? "Germany" : "",
      language: inferLanguage(`${title} ${snippet}`),
      workModel: inferWorkModel(`${title} ${snippet} ${location}`),
      employmentType: inferEmploymentType(snippet),
      salary,
      description: snippet,
      url: href,
      applyUrl: href,
      source: source.name,
      sourceType: "job_board",
      sourceUrls: uniqueNonEmpty([href]),
      companyUrl: normalizeUrl(companyAnchor.attr("href") ?? ""),
      careersUrl: "",
      aboutUrl: "",
      teamUrl: "",
      contactUrl: "",
      pressUrl: "",
      companyLinkedinUrl: normalizeUrl(companyAnchor.attr("href") ?? ""),
      publicContacts: [],
      postedAt: listedAt,
      validThrough: "",
      department: "",
      experienceYearsText: (snippet.match(/(\d+\+?\s+years?)/i)?.[1] ?? "").trim(),
      remoteScope: inferWorkModel(`${title} ${snippet} ${location}`) === "remote" ? "global" : "",
      applicantLocationRequirements: [],
      applicationContactName: "",
      applicationContactEmail: "",
      parseConfidence: 0.74,
      sourceConfidence: 0.76,
      isRealJobPage: true,
      raw: { provider: "linkedin" },
    });
  });
  return listings;
}

function extractGoogleBlocks(html: string): Array<{ title: string; company: string; location: string; snippet: string; url: string; postedAt: string }> {
  const blocks: Array<{ title: string; company: string; location: string; snippet: string; url: string; postedAt: string }> = [];
  const hiddenData = [
    ...html.matchAll(/520084652":(\[.*?\]\s*])\s*}\s*]\s*]\s*]\s*]\s*]/gs),
    ...html.matchAll(/520084652":(\[\[.*?\]\])/gs),
  ];
  for (const match of hiddenData) {
    try {
      const data = JSON.parse(match[1] ?? "[]") as Array<unknown>;
      for (const item of data) {
        if (!Array.isArray(item)) continue;
        const title = typeof item[0] === "string" ? item[0] : "";
        const company = typeof item[1] === "string" ? item[1] : "";
        const location = typeof item[2] === "string" ? item[2] : "";
        const url = Array.isArray(item[3]) && Array.isArray(item[3][0]) ? String(item[3][0][0] ?? "") : "";
        const postedAt = typeof item[12] === "string" ? item[12] : "";
        const snippet = typeof item[19] === "string" ? item[19] : "";
        if (title && company && url) {
          blocks.push({ title, company, location, snippet, url, postedAt });
        }
      }
    } catch {
      // Ignore malformed hidden blocks and continue with DOM fallback.
    }
  }
  return blocks;
}

function parseGoogleListings(html: string, source: JobBoardSource): ListingCandidate[] {
  const blocks = extractGoogleBlocks(html);
  const seen = new Set<string>();
  return blocks.flatMap((block) => {
    const url = normalizeUrl(block.url);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    const description = summarizeToLine(decodeEntities(block.snippet || `${block.title} ${block.company} ${block.location}`), 1000);
    return [{
      lane: source.lane,
      externalId: url,
      title: block.title,
      titleFamily: "",
      company: block.company,
      location: block.location,
      country: /berlin|germany|deutschland/i.test(block.location) ? "Germany" : "",
      language: inferLanguage(`${block.title} ${description}`),
      workModel: inferWorkModel(`${block.title} ${description} ${block.location}`),
      employmentType: inferEmploymentType(description),
      salary: "",
      description,
      url,
      applyUrl: url,
      source: source.name,
      sourceType: "job_board",
      sourceUrls: uniqueNonEmpty([url]),
      companyUrl: domainFromUrl(url) ? `https://${domainFromUrl(url)}` : "",
      careersUrl: "",
      aboutUrl: "",
      teamUrl: "",
      contactUrl: "",
      pressUrl: "",
      companyLinkedinUrl: "",
      publicContacts: [],
      postedAt: block.postedAt,
      validThrough: "",
      department: "",
      experienceYearsText: (description.match(/(\d+\+?\s+years?)/i)?.[1] ?? "").trim(),
      remoteScope: inferWorkModel(`${block.title} ${description} ${block.location}`) === "remote" ? "global" : "",
      applicantLocationRequirements: [],
      applicationContactName: "",
      applicationContactEmail: "",
      parseConfidence: 0.62,
      sourceConfidence: 0.58,
      isRealJobPage: true,
      raw: { provider: "google_jobs" },
    }];
  });
}

export async function discoverFromJobBoard(
  source: JobBoardSource,
  deps: Dependencies,
  config: SniperConfig,
): Promise<ListingCandidate[]> {
  const query = buildSearchTerm(config, source);
  const location = source.location?.trim() || "Berlin";
  const maxResults = source.maxResults ?? config.search.maxResultsPerQuery;

  if (source.provider === "linkedin") {
    const response = await deps.fetch(buildLinkedInUrl(query, location, maxResults));
    if (!response.ok) {
      throw new Error(`LinkedIn board fetch failed for ${source.name} with ${response.status}`);
    }
    const html = await response.text();
    return parseLinkedInListings(html, source).slice(0, maxResults);
  }

  const googleQuery = `${query} jobs near ${location}`.trim();
  const response = await deps.fetch(`https://www.google.com/search?${new URLSearchParams({ q: googleQuery, udm: "8" }).toString()}`);
  if (!response.ok) {
    throw new Error(`Google Jobs fetch failed for ${source.name} with ${response.status}`);
  }
  const html = await response.text();
  return parseGoogleListings(html, source).slice(0, maxResults);
}

export function buildJobBoardSourceBreakdownKey(provider: JobBoardSource["provider"]): string {
  return `job_board_${provider}`;
}

export function inferBoardLane(source: JobBoardSource): SearchLane {
  return source.lane;
}
