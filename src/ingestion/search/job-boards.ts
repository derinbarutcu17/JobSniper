import * as cheerio from "cheerio";
import { collectQueryTerms } from "../../normalization/role-packs.js";
import { decodeEntities, summarizeToLine, uniqueNonEmpty } from "../../lib/text.js";
import { domainFromUrl, normalizeUrl } from "../../lib/url.js";
import type { Dependencies, JobBoardSource, ListingCandidate, SearchLane, SniperConfig } from "../../types.js";

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
    ...html.matchAll(/520084652":(\[.*?\]\s*])\s*}\s*]\s*]\s*]\s*]/gs),
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
      // Ignore malformed hidden blocks.
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

async function fetchYCJobs(source: JobBoardSource, deps: Dependencies, config: SniperConfig): Promise<ListingCandidate[]> {
  const response = await deps.fetch("https://www.ycombinator.com/api/jobs");
  if (!response.ok) {
    throw new Error(`YC Jobs API fetch failed with ${response.status}`);
  }
  const json = (await response.json()) as { jobs?: Array<Record<string, unknown>> };
  const maxResults = source.maxResults ?? config.search.maxResultsPerQuery;

  return (json.jobs ?? [])
    .filter((job) => {
      const location = String(job.location ?? "").toLowerCase();
      const title = String(job.title ?? "").toLowerCase();
      const isBerlinOrRemote = /berlin|germany|remote|europe|eu/.test(location);
      const hasKeyword = /design|engineer|product|frontend|ai|llm|agent|typescript|python|react/.test(title);
      return isBerlinOrRemote && hasKeyword;
    })
    .slice(0, maxResults)
    .map((job) => {
      const location = String(job.location ?? "");
      const title = String(job.title ?? "");
      const company = String(job.company_name ?? job.company ?? "YC company");
      const url = String(job.url ?? `https://www.ycombinator.com/companies/${String(job.company_id ?? "").toLowerCase()}/jobs/${String(job.id ?? "")}`);
      const description = summarizeToLine(String(job.description ?? `${title} at ${company} in ${location}`), 1000);
      return {
        lane: source.lane,
        externalId: String(job.id ?? url),
        title,
        titleFamily: "",
        company,
        location,
        country: /berlin|germany|deutschland/i.test(location) ? "Germany" : /europe|eu|remote/i.test(location) ? "" : "",
        language: inferLanguage(`${title} ${description}`),
        workModel: inferWorkModel(`${title} ${description} ${location}`),
        employmentType: String(job.job_type ?? ""),
        salary: "",
        description,
        url,
        applyUrl: url,
        source: source.name,
        sourceType: "job_board",
        sourceUrls: uniqueNonEmpty([url]),
        companyUrl: `https://www.ycombinator.com/companies/${String(job.company_id ?? "").toLowerCase()}`,
        careersUrl: url,
        aboutUrl: "",
        teamUrl: "",
        contactUrl: "",
        pressUrl: "",
        companyLinkedinUrl: "",
        publicContacts: [],
        postedAt: String(job.created_at ?? ""),
        validThrough: "",
        department: String(job.department ?? ""),
        experienceYearsText: "",
        remoteScope: /remote/i.test(location) ? "global" : "",
        applicantLocationRequirements: [],
        applicationContactName: "",
        applicationContactEmail: "",
        parseConfidence: 0.88,
        sourceConfidence: 0.9,
        isRealJobPage: true,
        raw: { provider: "yc_jobs", ...job },
      };
    });
}

async function fetchRemoteOK(source: JobBoardSource, deps: Dependencies, config: SniperConfig): Promise<ListingCandidate[]> {
  const response = await deps.fetch("https://remoteok.com/api");
  if (!response.ok) {
    throw new Error(`RemoteOK fetch failed with ${response.status}`);
  }
  const json = (await response.json()) as Array<Record<string, unknown>>;
  const maxResults = source.maxResults ?? config.search.maxResultsPerQuery;

  return json
    .filter((job) => String(job.id ?? "") !== "header")
    .filter((job) => {
      const location = String(job.location ?? "").toLowerCase();
      const tags = Array.isArray(job.tags) ? (job.tags as Array<Record<string, unknown>>).map((t) => String(t.tag ?? "")).join(" ").toLowerCase() : "";
      const isEuropeOrRemote = /europe|eu|berlin|germany|remote|worldwide/.test(location) || /europe|berlin|germany/.test(tags);
      return isEuropeOrRemote;
    })
    .slice(0, maxResults)
    .map((job) => {
      const title = String(job.position ?? job.title ?? "Untitled role");
      const company = String(job.company ?? "RemoteOK company");
      const location = String(job.location ?? "Remote");
      const url = String(job.url ?? "");
      const description = summarizeToLine(String(job.description ?? `${title} at ${company}`), 1000);
      const tags = Array.isArray(job.tags) ? (job.tags as Array<Record<string, unknown>>).map((t) => String(t.tag ?? "")).join(" ") : "";
      return {
        lane: source.lane,
        externalId: String(job.id ?? url),
        title,
        titleFamily: "",
        company,
        location,
        country: /berlin|germany|deutschland/i.test(location) ? "Germany" : /europe|eu/i.test(location + " " + tags) ? "" : "",
        language: inferLanguage(`${title} ${description}`),
        workModel: inferWorkModel(`${title} ${description} ${location}`),
        employmentType: /full[- ]time/i.test(tags) ? "full-time" : /contract/i.test(tags) ? "contract" : "",
        salary: String(job.salary ?? ""),
        description,
        url,
        applyUrl: url,
        source: source.name,
        sourceType: "job_board",
        sourceUrls: uniqueNonEmpty([url]),
        companyUrl: "",
        careersUrl: url,
        aboutUrl: "",
        teamUrl: "",
        contactUrl: "",
        pressUrl: "",
        companyLinkedinUrl: "",
        publicContacts: [],
        postedAt: job.date ? new Date(Number(job.date) * 1000).toISOString() : "",
        validThrough: "",
        department: "",
        experienceYearsText: "",
        remoteScope: "global",
        applicantLocationRequirements: [],
        applicationContactName: "",
        applicationContactEmail: "",
        parseConfidence: 0.7,
        sourceConfidence: 0.72,
        isRealJobPage: true,
        raw: { provider: "remoteok", ...job },
      };
    });
}

async function fetchStepStone(source: JobBoardSource, deps: Dependencies, config: SniperConfig): Promise<ListingCandidate[]> {
  const query = buildSearchTerm(config, source);
  const location = source.location?.trim() || "Berlin";
  const maxResults = source.maxResults ?? config.search.maxResultsPerQuery;
  const url = `https://www.stepstone.de/jobs/${encodeURIComponent(query)}?st=${encodeURIComponent(location)}`;

  const response = await deps.fetch(url);
  if (!response.ok) {
    throw new Error(`StepStone fetch failed with ${response.status}`);
  }
  const html = await response.text();
  const $ = cheerio.load(html);
  const listings: ListingCandidate[] = [];

  $(".ResultCard").each((_, element) => {
    const title = $(element).find(".ResultCard-headline").text().trim();
    const company = $(element).find(".ResultCard-company").text().trim();
    const location = $(element).find(".ResultCard-location").text().trim();
    const anchor = $(element).find("a.ResultCard-link").first();
    const href = normalizeUrl(anchor.attr("href") ?? "");
    if (!title || !company || !href) return;
    const description = summarizeToLine($(element).find(".ResultCard-listingDescription").text().trim(), 1000);
    listings.push({
      lane: source.lane,
      externalId: href,
      title,
      titleFamily: "",
      company,
      location,
      country: /berlin|germany|deutschland/i.test(location) ? "Germany" : "",
      language: "de",
      workModel: inferWorkModel(`${title} ${description} ${location}`),
      employmentType: inferEmploymentType(description),
      salary: $(element).find(".ResultCard-salary").text().trim(),
      description,
      url: href,
      applyUrl: href,
      source: source.name,
      sourceType: "job_board",
      sourceUrls: uniqueNonEmpty([href]),
      companyUrl: "",
      careersUrl: "",
      aboutUrl: "",
      teamUrl: "",
      contactUrl: "",
      pressUrl: "",
      companyLinkedinUrl: "",
      publicContacts: [],
      postedAt: "",
      validThrough: "",
      department: "",
      experienceYearsText: (description.match(/(\d+\+?\s+[Jj]ahre)/)?.[1] ?? "").trim(),
      remoteScope: inferWorkModel(`${title} ${description} ${location}`) === "remote" ? "global" : "",
      applicantLocationRequirements: [],
      applicationContactName: "",
      applicationContactEmail: "",
      parseConfidence: 0.68,
      sourceConfidence: 0.7,
      isRealJobPage: true,
      raw: { provider: "stepstone" },
    });
  });

  return listings.slice(0, maxResults);
}

async function fetchIndeed(source: JobBoardSource, deps: Dependencies, config: SniperConfig): Promise<ListingCandidate[]> {
  const query = buildSearchTerm(config, source);
  const location = source.location?.trim() || "Berlin";
  const maxResults = source.maxResults ?? config.search.maxResultsPerQuery;
  const url = `https://de.indeed.com/Jobs?q=${encodeURIComponent(query)}&l=${encodeURIComponent(location)}`;

  const response = await deps.fetch(url);
  if (!response.ok) {
    throw new Error(`Indeed fetch failed with ${response.status}`);
  }
  const html = await response.text();
  const $ = cheerio.load(html);
  const listings: ListingCandidate[] = [];

  $(".job_seen_beacon, .resultContent").each((_, element) => {
    const anchor = $(element).find("a.jcs-JobTitle, a.jobTitle").first();
    const title = anchor.text().trim();
    const href = normalizeUrl(anchor.attr("href") ?? "");
    const company = $(element).find(".companyName, .company").text().trim();
    const location = $(element).find(".companyLocation, .location").text().trim();
    if (!title || !href) return;
    const description = summarizeToLine($(element).find(".job-snippet, .summary").text().trim(), 1000);
    const fullUrl = href.startsWith("/") ? `https://de.indeed.com${href}` : href;
    listings.push({
      lane: source.lane,
      externalId: fullUrl,
      title,
      titleFamily: "",
      company,
      location,
      country: /berlin|germany|deutschland/i.test(location) ? "Germany" : "",
      language: "de",
      workModel: inferWorkModel(`${title} ${description} ${location}`),
      employmentType: inferEmploymentType(description),
      salary: "",
      description,
      url: fullUrl,
      applyUrl: fullUrl,
      source: source.name,
      sourceType: "job_board",
      sourceUrls: uniqueNonEmpty([fullUrl]),
      companyUrl: "",
      careersUrl: "",
      aboutUrl: "",
      teamUrl: "",
      contactUrl: "",
      pressUrl: "",
      companyLinkedinUrl: "",
      publicContacts: [],
      postedAt: $(element).find(".date").text().trim(),
      validThrough: "",
      department: "",
      experienceYearsText: "",
      remoteScope: inferWorkModel(`${title} ${description} ${location}`) === "remote" ? "global" : "",
      applicantLocationRequirements: [],
      applicationContactName: "",
      applicationContactEmail: "",
      parseConfidence: 0.6,
      sourceConfidence: 0.62,
      isRealJobPage: true,
      raw: { provider: "indeed" },
    });
  });

  return listings.slice(0, maxResults);
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

  if (source.provider === "yc_jobs") {
    return fetchYCJobs(source, deps, config);
  }

  if (source.provider === "remoteok") {
    return fetchRemoteOK(source, deps, config);
  }

  if (source.provider === "stepstone") {
    return fetchStepStone(source, deps, config);
  }

  if (source.provider === "indeed") {
    return fetchIndeed(source, deps, config);
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
