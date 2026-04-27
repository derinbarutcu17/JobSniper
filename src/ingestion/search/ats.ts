import { mapLimit } from "../../lib/async.js";
import { defaultConfig } from "../../normalization/config.js";
import { normalizeText, summarizeToLine, uniqueNonEmpty } from "../../lib/text.js";
import { domainFromUrl, normalizeUrl } from "../../lib/url.js";
import * as cheerio from "cheerio";
import { collectQueryTerms, getDefaultCompanyWatchLane, getDefaultJobLane, inferRolePackLane, isCompanyWatchLane } from "../../normalization/role-packs.js";
import type {
  AtsBoardSource,
  ContactCandidate,
  Dependencies,
  ListingCandidate,
  PageRecord,
  SearchLane,
  SearchQuery,
  SearchResult,
  SniperConfig,
  SourceType,
} from "../../types.js";
import { buildPageRecord, extractContacts, parseCareerHub, parseGenericListing, parseJsonLdListings } from "./extract.js";
import { getSearchProviders } from "./web.js";

export interface CrawlOutcome {
  page: PageRecord;
  contacts: ContactCandidate[];
  listings: ListingCandidate[];
  childUrls: string[];
  usedBrowserFallback: boolean;
}

type AtsProvider =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workable"
  | "teamtailor"
  | "smartrecruiters"
  | "recruitee"
  | "personio"
  | "wellfound"
  | "generic";

function inferProvider(url: string): AtsProvider {
  const hostname = domainFromUrl(url);
  if (hostname.includes("greenhouse")) return "greenhouse";
  if (hostname.includes("lever")) return "lever";
  if (hostname.includes("ashby")) return "ashby";
  if (hostname.includes("workable")) return "workable";
  if (hostname.includes("teamtailor")) return "teamtailor";
  if (hostname.includes("smartrecruiters")) return "smartrecruiters";
  if (hostname.includes("recruitee")) return "recruitee";
  if (hostname.includes("personio")) return "personio";
  if (hostname.includes("wellfound")) return "wellfound";
  return "generic";
}

function inferWorkModel(text: string): ListingCandidate["workModel"] {
  const lower = text.toLowerCase();
  if (lower.includes("remote") || lower.includes("telecommute") || lower.includes("uzaktan")) return "remote";
  if (lower.includes("hybrid")) return "hybrid";
  if (lower.includes("onsite") || lower.includes("on-site")) return "onsite";
  return "unknown";
}

function buildAtsListing(
  source: AtsBoardSource,
  lane: SearchLane,
  job: Record<string, unknown>,
  opts: {
    title: string;
    company?: string;
    location?: string;
    employmentType?: string;
    description?: string;
    url?: string;
    postedAt?: string;
    department?: string;
  },
): ListingCandidate {
  const url = normalizeUrl(opts.url || source.url);
  const description = summarizeToLine(opts.description || "", 1400);
  const location = opts.location || "";
  return {
    lane,
    externalId: String(job.id ?? job.identifier ?? url),
    title: opts.title || "Untitled role",
    titleFamily: "",
    company: opts.company || source.name,
    location,
    country: /germany|deutschland/i.test(location) ? "Germany" : "",
    language: /\b(deutsch|german)\b/i.test(description) ? "de" : "en",
    workModel: inferWorkModel(description),
    employmentType: opts.employmentType || "",
    salary: "",
    description,
    url,
    applyUrl: url,
    source: source.name,
    sourceType: "ats",
    sourceUrls: uniqueNonEmpty([source.url, url]),
    companyUrl: domainFromUrl(url) ? `https://${domainFromUrl(url)}` : "",
    careersUrl: source.url,
    aboutUrl: "",
    teamUrl: "",
    contactUrl: "",
    pressUrl: "",
    companyLinkedinUrl: "",
    publicContacts: [],
    postedAt: opts.postedAt || "",
    validThrough: "",
    department: opts.department || "",
    experienceYearsText: "",
    remoteScope: inferWorkModel(description) === "remote" ? "global" : "",
    applicantLocationRequirements: [],
    applicationContactName: "",
    applicationContactEmail: "",
    parseConfidence: 0.92,
    sourceConfidence: 0.92,
    isRealJobPage: true,
    raw: job,
  };
}

async function fetchGreenhouseBoard(source: AtsBoardSource, deps: Dependencies): Promise<ListingCandidate[]> {
  const match = normalizeUrl(source.url).match(/greenhouse(?:\.io|)\/*(?:job-boards\/)?([^/?#]+)/i);
  const board = match?.[1];
  if (!board) return [];

  const response = await deps.fetch(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`);
  if (!response.ok) {
    throw new Error(`Greenhouse board fetch failed for ${source.url}`);
  }
  const payload = (await response.json()) as { jobs?: Array<Record<string, unknown>> };
  const lane = source.lane ?? "general_jobs";
  return (payload.jobs ?? []).map((job) =>
    buildAtsListing(source, lane, job, {
      title: String(job.title ?? "Untitled role"),
      company: source.name,
      location: String((job.location as Record<string, unknown> | undefined)?.name ?? ""),
      description: String(job.content ?? ""),
      url: String(job.absolute_url ?? source.url),
      postedAt: String(job.updated_at ?? ""),
      department: String((job.metadata as Array<Record<string, unknown>> | undefined)?.[0]?.value ?? ""),
    }),
  );
}

async function fetchLeverBoard(source: AtsBoardSource, deps: Dependencies): Promise<ListingCandidate[]> {
  const match = normalizeUrl(source.url).match(/jobs\.lever\.co\/([^/?#]+)/i);
  const board = match?.[1];
  if (!board) return [];

  const response = await deps.fetch(`https://api.lever.co/v0/postings/${board}?mode=json`);
  if (!response.ok) {
    throw new Error(`Lever board fetch failed for ${source.url}`);
  }
  const payload = (await response.json()) as Array<Record<string, unknown>>;
  const lane = source.lane ?? "general_jobs";
  return payload.map((job) =>
    buildAtsListing(source, lane, job, {
      title: String(job.text ?? "Untitled role"),
      company: source.name,
      location: String((job.categories as Record<string, unknown> | undefined)?.location ?? ""),
      employmentType: String((job.categories as Record<string, unknown> | undefined)?.commitment ?? ""),
      description: String(job.descriptionPlain ?? ""),
      url: String(job.hostedUrl ?? source.url),
      postedAt: String(job.createdAt ?? ""),
      department: String((job.categories as Record<string, unknown> | undefined)?.team ?? ""),
    }),
  );
}

function mergeStructuredContacts(listings: ListingCandidate[]): ListingCandidate[] {
  return listings.map((listing) => {
    if (!listing.applicationContactEmail) {
      return listing;
    }
    const contact: ContactCandidate = {
      kind: "application_email",
      name: listing.applicationContactName,
      title: "Application Contact",
      email: listing.applicationContactEmail,
      linkedinUrl: "",
      sourceUrl: listing.url,
      confidence: "high",
      evidenceType: "structured_data",
      evidenceExcerpt: listing.applicationContactEmail,
      isPublic: true,
      pageType: "job_detail",
    };
    return {
      ...listing,
      publicContacts: [...listing.publicContacts, contact],
    };
  });
}

function wellfoundChallengeDetected(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes("datadome") ||
    lower.includes("captcha-delivery.com") ||
    lower.includes("geo.captcha-delivery.com") ||
    lower.includes("datadome captcha") ||
    lower.includes("please enable js") ||
    lower.includes("disable any ad blocker")
  );
}

function deriveTitleAndCompany(title: string): { title: string; company: string } {
  const cleaned = title
    .replace(/\s*\|\s*wellfound.*$/i, "")
    .replace(/\s*-\s*wellfound.*$/i, "")
    .trim();
  const atMatch = cleaned.match(/^(.*?)\s+at\s+(.*)$/i);
  if (atMatch) {
    return { title: atMatch[1]!.trim(), company: atMatch[2]!.trim() };
  }
  const dashMatch = cleaned.match(/^(.*?)\s+[–-]\s+(.*?)$/);
  if (dashMatch) {
    return { title: dashMatch[1]!.trim(), company: dashMatch[2]!.trim() };
  }
  return { title: cleaned, company: "" };
}

function buildWellfoundListingFromSearchResult(source: AtsBoardSource, result: SearchResult, config: SniperConfig): ListingCandidate {
  const parsed = deriveTitleAndCompany(result.title);
  const description = summarizeToLine(result.snippet, 1000);
  const location =
    /berlin/i.test(result.snippet) ? "Berlin" :
    /germany|deutschland/i.test(result.snippet) ? "Germany" :
    /remote/i.test(result.snippet) ? "Remote" :
    "";
  return {
    lane: source.lane ?? inferRolePackLane(config, `${result.title} ${result.snippet}`, "job"),
    externalId: result.url,
    title: parsed.title || result.title,
    titleFamily: "",
    company: parsed.company || "Wellfound company",
    location,
    country: /berlin|germany|deutschland/i.test(`${location} ${result.snippet}`) ? "Germany" : "",
    language: /\b(deutsch|german)\b/i.test(result.snippet) ? "de" : "en",
    workModel: inferWorkModel(result.snippet),
    employmentType: /full[- ]time/i.test(result.snippet) ? "full-time" : "",
    salary: "",
    description,
    url: result.url,
    applyUrl: result.url,
    source: "Wellfound search fallback",
    sourceType: "search",
    sourceUrls: uniqueNonEmpty([source.url, result.url]),
    companyUrl: result.url.includes("/company/") ? result.url : "",
    careersUrl: source.url,
    aboutUrl: "",
    teamUrl: "",
    contactUrl: "",
    pressUrl: "",
    companyLinkedinUrl: "",
    publicContacts: [],
    postedAt: "",
    validThrough: "",
    department: "",
    experienceYearsText: (result.snippet.match(/(\d+\+?\s+years?)/i)?.[1] ?? "").trim(),
    remoteScope: /remote/i.test(result.snippet) ? "global" : "",
    applicantLocationRequirements: [],
    applicationContactName: "",
    applicationContactEmail: "",
    parseConfidence: result.url.includes("/jobs/") ? 0.44 : 0.28,
    sourceConfidence: result.url.includes("/jobs/") ? 0.62 : 0.48,
    isRealJobPage: result.url.includes("/jobs/"),
    raw: { provider: "wellfound", fallback: "search_result", query: result.query },
  };
}

function buildWellfoundCompanyFromSearchResult(source: AtsBoardSource, result: SearchResult, config: SniperConfig): ListingCandidate {
  const cleaned = result.title
    .replace(/\s*\|\s*wellfound.*$/i, "")
    .replace(/\s*-\s*wellfound.*$/i, "")
    .trim();
  const location =
    /berlin/i.test(result.snippet) ? "Berlin" :
    /germany|deutschland/i.test(result.snippet) ? "Germany" :
    "";
  return {
    lane: source.lane ?? getDefaultCompanyWatchLane(config),
    externalId: result.url,
    title: cleaned,
    titleFamily: "",
    company: cleaned,
    location,
    country: /berlin|germany|deutschland/i.test(`${location} ${result.snippet}`) ? "Germany" : "",
    language: /\b(deutsch|german)\b/i.test(result.snippet) ? "de" : "en",
    workModel: inferWorkModel(result.snippet),
    employmentType: "",
    salary: "",
    description: summarizeToLine(result.snippet, 1000),
    url: result.url,
    applyUrl: result.url,
    source: "Wellfound search fallback",
    sourceType: "search",
    sourceUrls: uniqueNonEmpty([source.url, result.url]),
    companyUrl: result.url,
    careersUrl: result.url.endsWith("/jobs") ? result.url : `${result.url.replace(/\/$/, "")}/jobs`,
    aboutUrl: result.url,
    teamUrl: "",
    contactUrl: result.url,
    pressUrl: "",
    companyLinkedinUrl: "",
    publicContacts: [],
    postedAt: "",
    validThrough: "",
    department: "",
    experienceYearsText: "",
    remoteScope: "",
    applicantLocationRequirements: [],
    applicationContactName: "",
    applicationContactEmail: "",
    parseConfidence: 0.34,
    sourceConfidence: 0.6,
    isRealJobPage: false,
    raw: { provider: "wellfound", fallback: "search_result", query: result.query, type: "company_watch" },
  };
}

function buildWellfoundFallbackQueries(source: AtsBoardSource, config: SniperConfig): SearchQuery[] {
  const lane = source.lane ?? getDefaultCompanyWatchLane(config);
  if (isCompanyWatchLane(config, lane)) {
    return [
      { lane, locale: "en", family: "company", query: 'site:wellfound.com/company Berlin startup', providerHints: ["wellfound"] },
      { lane, locale: "en", family: "company", query: 'site:wellfound.com/company "Berlin" AI startup', providerHints: ["wellfound"] },
    ];
  }
  const packQueries = collectQueryTerms(config, lane).slice(0, 2);
  if (packQueries.length) {
    return packQueries.flatMap((term) => ([
      { lane, locale: "en", family: "job", query: `site:wellfound.com/jobs "${term}" "Berlin"`, providerHints: ["wellfound"] },
      { lane, locale: "en", family: "job", query: `site:wellfound.com/jobs "${term}" Germany`, providerHints: ["wellfound"] },
    ]));
  }
  return [
    { lane, locale: "en", family: "job", query: 'site:wellfound.com/jobs startup Berlin', providerHints: ["wellfound"] },
    { lane, locale: "en", family: "job", query: 'site:wellfound.com/jobs startup Germany', providerHints: ["wellfound"] },
  ];
}

function scoreWellfoundFallbackResult(
  source: AtsBoardSource,
  result: SearchResult,
  config: SniperConfig,
): number {
  const lane = source.lane ?? getDefaultJobLane(config);
  const text = normalizeText(`${result.title} ${result.snippet}`);
  const laneTerms = collectQueryTerms(config, lane).map(normalizeText);
  const titleTermHits = laneTerms.filter((term) => normalizeText(result.title).includes(term)).length;
  const snippetTermHits = laneTerms.filter((term) => normalizeText(result.snippet).includes(term)).length;
  const isJobUrl = /wellfound\.com\/jobs\//i.test(result.url);
  const isCompanyUrl = /wellfound\.com\/company\//i.test(result.url);
  const hasBerlinSignal = /\bberlin\b/i.test(result.snippet);
  const hasGermanySignal = /\bgermany|deutschland\b/i.test(result.snippet);
  const hasRemoteSignal = /\bremote\b/i.test(result.snippet);
  const vagueSnippet = result.snippet.trim().length < 24;
  const weakTitle = /\bwellfound\b/i.test(result.title) && !/\bat\b|[-–|]/.test(result.title);
  const pressyNoise = /\bnews|funding|raises|launches|series [abc]|hiring trend\b/i.test(result.title);
  const locationMiss = !hasBerlinSignal && !hasGermanySignal && !hasRemoteSignal;

  return (
    (isJobUrl ? 12 : 0) +
    (isCompanyUrl ? 5 : 0) +
    titleTermHits * 4 +
    snippetTermHits * 2 +
    (hasBerlinSignal ? 6 : 0) +
    (hasGermanySignal ? 3 : 0) +
    (hasRemoteSignal ? 2 : 0) -
    (vagueSnippet ? 5 : 0) -
    (weakTitle ? 3 : 0) -
    (pressyNoise ? 8 : 0) -
    (locationMiss ? 2 : 0) +
    (text.includes("startup") ? 1 : 0)
  );
}

async function fetchWellfoundFromSearchFallback(source: AtsBoardSource, deps: Dependencies, config: SniperConfig): Promise<ListingCandidate[]> {
  const providers = getSearchProviders();
  const queries = buildWellfoundFallbackQueries(source, config);
  const results: SearchResult[] = [];
  const providerQueries = queries.flatMap((query) => providers.map((provider) => ({ query, provider })));
  const batches = await mapLimit(providerQueries, 3, async ({ query, provider }) => {
    try {
      return (await provider.search(query, deps)).filter((result) => /wellfound\.com/i.test(result.url));
    } catch {
      return [];
    }
  });
  results.push(...batches.flat());

  const deduped = new Map<string, SearchResult>();
  for (const result of results) {
    deduped.set(normalizeUrl(result.url), result);
  }
  const uniqueResults = [...deduped.values()]
    .map((result) => ({ result, score: scoreWellfoundFallbackResult(source, result, config) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .map(({ result }) => result)
    .slice(0, 25);
  if (isCompanyWatchLane(config, source.lane ?? getDefaultCompanyWatchLane(config))) {
    return uniqueResults.map((result) => buildWellfoundCompanyFromSearchResult(source, result, config));
  }
  const jobResults = uniqueResults.filter((result) => /wellfound\.com\/jobs\//i.test(result.url));
  const companyResults = uniqueResults.filter((result) => /wellfound\.com\/company\//i.test(result.url));
  const primary = (jobResults.length ? jobResults : companyResults).map((result) =>
    buildWellfoundListingFromSearchResult(source, result, config),
  );
  return primary;
}

export async function crawlUrl(
  url: string,
  lane: SearchLane,
  sourceType: SourceType,
  provider: string,
  deps: Dependencies,
  config: SniperConfig = defaultConfig,
): Promise<CrawlOutcome> {
  const response = await deps.fetch(url);
  if (!response.ok) {
    throw new Error(`Fetch failed with ${response.status} for ${url}`);
  }

  const html = await response.text();
  const page = buildPageRecord(url, html, provider, sourceType);
  const contacts = extractContacts(page);
  const structured = mergeStructuredContacts(parseJsonLdListings(page, lane, contacts));
  const listings =
    structured.length > 0
      ? structured
      : page.pageType === "job_detail"
        ? parseGenericListing(page, lane, contacts)
        : [];
  const childUrls = page.pageType === "career_hub" ? parseCareerHub(page, lane) : [];

  return {
    page,
    contacts,
    listings,
    childUrls,
    usedBrowserFallback: false,
  };
}

function absoluteWellfoundUrl(href: string): string {
  if (!href) return "";
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("//")) return `https:${href}`;
  return `https://wellfound.com${href.startsWith("/") ? href : `/${href}`}`;
}

async function fetchWellfoundBoard(source: AtsBoardSource, deps: Dependencies, config: SniperConfig = defaultConfig): Promise<ListingCandidate[]> {
  const response = await deps.fetch(source.url);
  if (!response.ok) {
    return fetchWellfoundFromSearchFallback(source, deps, config);
  }
  const html = await response.text();
  if (wellfoundChallengeDetected(html)) {
    return fetchWellfoundFromSearchFallback(source, deps, config);
  }
  const $ = cheerio.load(html);
  const listings: ListingCandidate[] = [];

  if (isCompanyWatchLane(config, source.lane ?? getDefaultCompanyWatchLane(config))) {
    const seen = new Set<string>();
    $("a[href*='/company/']").each((_, element) => {
      const anchor = $(element);
      const title = anchor.text().trim();
      const href = absoluteWellfoundUrl(anchor.attr("href") ?? "");
      if (!title || !href || seen.has(href) || href.endsWith('/jobs') || /^view\s+/i.test(title) || /view\s+all\s+\d+\s+jobs/i.test(title) || /company logo/i.test(title)) return;
      seen.add(href);
      const cardText = anchor.closest("div").parent().text().replace(/\s+/g, " ").trim();
      listings.push({
        lane: source.lane ?? getDefaultCompanyWatchLane(config),
        externalId: href,
        title,
        titleFamily: "",
        company: title,
        location: /berlin/i.test(cardText) ? "Berlin" : "",
        country: /germany|deutschland/i.test(cardText) || /berlin/i.test(cardText) ? "Germany" : "",
        language: /\b(deutsch|german)\b/i.test(cardText) ? "de" : "en",
        workModel: inferWorkModel(cardText),
        employmentType: "",
        salary: "",
        description: summarizeToLine(cardText, 1200),
        url: href,
        applyUrl: href,
        source: "Wellfound",
        sourceType: "ats",
        sourceUrls: uniqueNonEmpty([source.url, href]),
        companyUrl: href,
        careersUrl: href.endsWith("/jobs") ? href : `${href}/jobs`,
        aboutUrl: href,
        teamUrl: "",
        contactUrl: href,
        pressUrl: "",
        companyLinkedinUrl: "",
        publicContacts: [],
        postedAt: "",
        validThrough: "",
        department: "",
        experienceYearsText: "",
        remoteScope: "",
        applicantLocationRequirements: [],
        applicationContactName: "",
        applicationContactEmail: "",
        parseConfidence: 0.78,
        sourceConfidence: 0.82,
        isRealJobPage: false,
        raw: { provider: "wellfound", type: "company_watch" },
      });
    });
    return listings;
  }

  const seen = new Set<string>();
  $("a[href*='/jobs/']").each((_, element) => {
    const anchor = $(element);
    const title = anchor.text().trim();
    const href = absoluteWellfoundUrl(anchor.attr("href") ?? "");
    if (!title || !href || seen.has(href) || /^find jobs$/i.test(title) || /^view\s+/i.test(title) || /company logo/i.test(title)) return;
    seen.add(href);
    const cardText = anchor.closest("div").parent().text().replace(/\s+/g, " ").trim();
    listings.push({
      lane: source.lane ?? getDefaultJobLane(config),
      externalId: href,
      title,
      titleFamily: "",
      company: "",
      location: /berlin/i.test(cardText) ? "Berlin" : /remote/i.test(cardText) ? "Remote" : "",
      country: /germany|deutschland/i.test(cardText) || /berlin/i.test(cardText) ? "Germany" : "",
      language: /\b(deutsch|german)\b/i.test(cardText) ? "de" : "en",
      workModel: inferWorkModel(cardText),
      employmentType: /full-time/i.test(cardText) ? "full-time" : "",
      salary: (cardText.match(/([$€£][^•]+(?:•\s*[^•]+)?)/)?.[1] ?? "").trim(),
      description: summarizeToLine(cardText, 1200),
      url: href,
      applyUrl: href,
      source: "Wellfound",
      sourceType: "ats",
      sourceUrls: uniqueNonEmpty([source.url, href]),
      companyUrl: "",
      careersUrl: source.url,
      aboutUrl: "",
      teamUrl: "",
      contactUrl: "",
      pressUrl: "",
      companyLinkedinUrl: "",
      publicContacts: [],
      postedAt: (cardText.match(/(\d+\s+(?:day|days|week|weeks|month|months)\s+ago)/i)?.[1] ?? "").trim(),
      validThrough: "",
      department: "",
      experienceYearsText: (cardText.match(/(\d+\s+years?\s+of\s+exp)/i)?.[1] ?? "").trim(),
      remoteScope: /remote/i.test(cardText) ? "global" : "",
      applicantLocationRequirements: [],
      applicationContactName: "",
      applicationContactEmail: "",
      parseConfidence: 0.72,
      sourceConfidence: 0.8,
      isRealJobPage: true,
      raw: { provider: "wellfound", type: "job" },
    });
  });
  if (listings.length) {
    return listings;
  }
  return fetchWellfoundFromSearchFallback(source, deps, config);
}

async function discoverGenericBoard(source: AtsBoardSource, deps: Dependencies, config: SniperConfig = defaultConfig): Promise<ListingCandidate[]> {
  const lane = source.lane ?? getDefaultCompanyWatchLane(config);
  const outcome = await crawlUrl(source.url, lane, "ats", source.provider || inferProvider(source.url), deps, config);
  const direct = [...outcome.listings];
  if (direct.length || !outcome.childUrls.length) {
    return direct;
  }

  const expanded = await mapLimit(outcome.childUrls.slice(0, 20), 4, async (childUrl) => {
    try {
      const child = await crawlUrl(childUrl, source.lane ?? getDefaultJobLane(config), "ats", source.provider || inferProvider(childUrl), deps, config);
      return child.listings.filter((listing) => listing.isRealJobPage || listing.parseConfidence >= 0.45);
    } catch {
      return [];
    }
  });

  return [...direct, ...expanded.flat()];
}

export async function discoverFromAtsBoard(source: AtsBoardSource, deps: Dependencies, config: SniperConfig = defaultConfig): Promise<ListingCandidate[]> {
  switch (source.provider || inferProvider(source.url)) {
    case "greenhouse":
      return fetchGreenhouseBoard(source, deps);
    case "lever":
      return fetchLeverBoard(source, deps);
    case "wellfound":
      return fetchWellfoundBoard(source, deps, config);
    default:
      return discoverGenericBoard(source, deps, config);
  }
}

export async function expandSearchResult(result: SearchResult, deps: Dependencies, config: SniperConfig = defaultConfig): Promise<ListingCandidate[]> {
  const outcome = await crawlUrl(result.url, result.lane, "search", result.provider, deps, config);
  if (outcome.listings.length) {
    return outcome.listings;
  }
  if (!outcome.childUrls.length) {
    return [];
  }
  const nested = await mapLimit(outcome.childUrls.slice(0, 12), 4, async (childUrl) => {
    try {
      return (await crawlUrl(childUrl, result.lane, "career_page", result.provider, deps, config)).listings;
    } catch {
      return [];
    }
  });
  return nested.flat();
}
