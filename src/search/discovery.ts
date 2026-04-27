import { loadConfig } from "../config.js";
import {
  enqueueDiscoveryCandidates,
  markCandidateStatus,
  openDatabase,
  recordRunMetrics,
  summarizeRun,
  upsertCompany,
  upsertContact,
  upsertJob,
  upsertPageCache,
} from "../db.js";
import { mapLimit, withRetries, withTimeout } from "../lib/async.js";
import { createDefaultDependencies } from "../lib/http.js";
import { canonicalCompanyKey, canonicalContactKey, domainFromUrl, normalizeUrl } from "../lib/url.js";
import { buildDecisionSnapshot } from "../decision.js";
import { loadProfile } from "../profile.js";
import { getDefaultCompanyWatchLane, isCompanyWatchLane } from "../role-packs.js";
import { normalizeTitleFamily, scoreListing } from "../scoring.js";
import type { CompanyRecordInput, ContactCandidate, Dependencies, DiscoveryCandidate, ListingCandidate, PipelineContext, RunSummary, SearchLane } from "../types.js";
import { crawlUrl, discoverFromAtsBoard, expandSearchResult } from "./ats.js";
import { classifyCandidate } from "./classify.js";
import { gatherSearchCandidates } from "./frontier.js";
import { buildJobBoardSourceBreakdownKey, discoverFromJobBoard } from "./job-boards.js";
import { buildQueries } from "./queries.js";
import { discoverFromRss } from "./rss.js";
import { getSearchProviders } from "./web.js";

export interface RunDiscoveryOptions {
  lane?: SearchLane;
  companyWatchOnly?: boolean;
  context?: PipelineContext;
}

function sourceBreakdownAccumulator(sourceBreakdown: Record<string, number>, key: string, amount = 1): void {
  sourceBreakdown[key] = (sourceBreakdown[key] ?? 0) + amount;
}

function filterQueries(baseDir: string, lane?: SearchLane, companyWatchOnly = false) {
  const config = loadConfig(baseDir);
  const { profile } = loadProfile(baseDir);
  return buildQueries(config, profile).filter((query) => {
    if (companyWatchOnly) return isCompanyWatchLane(config, query.lane);
    if (lane) return query.lane === lane;
    return true;
  });
}

function buildCompanyInput(
  config: ReturnType<typeof loadConfig>,
  candidate: DiscoveryCandidate,
  pageText: string,
  contacts: ContactCandidate[],
): CompanyRecordInput {
  const domain = domainFromUrl(candidate.url);
  const location =
    /berlin/i.test(pageText) ? "Berlin" :
    /germany|deutschland/i.test(pageText) ? "Germany" :
    "";
  const startupSignals = [
    ...(/seed|series a|founding|small team|0->1|0-1/i.test(pageText) ? ["startup_language"] : []),
    ...(/startup|studio|builder/i.test(pageText) ? ["company_language"] : []),
  ];
  const hiringSignals = [
    ...(/hiring|join us|open roles|careers|jobs/i.test(pageText) ? ["hiring_page"] : []),
    ...(contacts.length ? ["public_contact_surface"] : []),
  ];
  const hasConcreteRoleSignal = /job opening|open roles|open positions|view jobs|apply now|we're hiring|we are hiring/i.test(pageText);
  const directEmailCount = contacts.filter((contact) => Boolean(contact.email)).length;
  const founderSurfaceCount = contacts.filter((contact) => contact.kind === "team_page" || contact.kind === "linkedin_person").length;
  const startupScore = startupSignals.length * 8;
  const companyFitScore = isCompanyWatchLane(config, candidate.lane) ? 8 : 6;
  const hiringSignalScore = hiringSignals.length * 4 + (hasConcreteRoleSignal ? 4 : 0);
  const contactabilityScore =
    directEmailCount > 0
      ? (contacts.some((contact) => contact.confidence === "high") ? 12 : 8)
      : founderSurfaceCount > 0
        ? 4
        : 0;

  return {
    canonicalKey: canonicalCompanyKey(domain || candidate.title || "unknown", domain),
    name: candidate.title.replace(/\s*[|\-].*$/, "").trim() || domain || "Unknown",
    domain,
    location,
    companyUrl: domain ? `https://${domain}` : candidate.url,
    careersUrl: /career|jobs|hiring/i.test(candidate.url) ? candidate.url : "",
    aboutUrl: /about/i.test(candidate.url) ? candidate.url : "",
    teamUrl: /team/i.test(candidate.url) ? candidate.url : "",
    contactUrl: /contact|imprint/i.test(candidate.url) ? candidate.url : "",
    pressUrl: /press/i.test(candidate.url) ? candidate.url : "",
    linkedinUrl: contacts.find((contact) => contact.kind === "linkedin_company")?.linkedinUrl ?? "",
    description: pageText.slice(0, 1200),
    sourceUrls: [candidate.url],
    publicContacts: contacts.map((contact) => contact.email || contact.linkedinUrl || contact.sourceUrl),
    startupSignals,
    hiringSignals,
    founderNames: [],
    cities: location ? [location] : [],
    sizeBand: "",
    stageText: startupSignals.length ? "startup signal" : "",
    remotePolicy: /remote|uzaktan|hybrid/i.test(pageText) ? "remote-friendly" : "",
    openRoleCount: hasConcreteRoleSignal ? 1 : 0,
    startupScore,
    companyFitScore,
    hiringSignalScore,
    contactabilityScore,
    isStartupCandidate: startupSignals.length > 0,
    lastSeenAt: new Date().toISOString(),
  };
}

async function collectConfiguredListings(
  config: ReturnType<typeof loadConfig>,
  deps: Dependencies,
  options: RunDiscoveryOptions,
  sourceBreakdown: Record<string, number>,
): Promise<ListingCandidate[]> {
  const listings: ListingCandidate[] = [];
  const context = options.context;
  for (const source of config.sources.rss) {
    if (options.lane && options.lane !== "company_watch" && options.lane !== undefined) {
      // RSS feeds are still useful across job lanes, so keep them unless user requests company-only mode.
    }
    try {
      const discovered = await withTimeout(discoverFromRss(source, deps, config), config.search.timeoutMs, `rss:${source.name}`);
      listings.push(...discovered.filter((listing) => (options.companyWatchOnly ? isCompanyWatchLane(config, listing.lane) : options.lane ? listing.lane === options.lane : true)));
      sourceBreakdownAccumulator(sourceBreakdown, "rss", discovered.length);
    } catch {
      sourceBreakdownAccumulator(sourceBreakdown, "rss_failed", 1);
      context?.warnings.push(`RSS source failed: ${source.name}`);
    }
  }

  for (const board of config.sources.atsBoards) {
    const boardLane = board.lane ?? getDefaultCompanyWatchLane(config);
    if (options.companyWatchOnly && !isCompanyWatchLane(config, boardLane)) continue;
    if (options.lane && boardLane !== options.lane) continue;
    try {
      const discovered = await withTimeout(discoverFromAtsBoard(board, deps, config), config.search.timeoutMs, `ats:${board.name}`);
      listings.push(...discovered);
      sourceBreakdownAccumulator(sourceBreakdown, "ats", discovered.length);
    } catch {
      sourceBreakdownAccumulator(sourceBreakdown, "ats_failed", 1);
      context?.warnings.push(`ATS board failed: ${board.name}`);
    }
  }

  for (const board of config.sources.jobBoards) {
    if (options.companyWatchOnly) continue;
    if (options.lane && board.lane !== options.lane) continue;
    try {
      const discovered = await withTimeout(
        discoverFromJobBoard(board, deps, config),
        config.search.timeoutMs,
        `job-board:${board.name}`,
      );
      listings.push(...discovered);
      sourceBreakdownAccumulator(sourceBreakdown, buildJobBoardSourceBreakdownKey(board.provider), discovered.length);
    } catch {
      sourceBreakdownAccumulator(sourceBreakdown, `${buildJobBoardSourceBreakdownKey(board.provider)}_failed`, 1);
      context?.warnings.push(`Job-board source failed: ${board.name}`);
    }
  }

  return listings;
}

export async function runDiscovery(
  baseDir: string,
  deps: Dependencies = createDefaultDependencies(),
  options: RunDiscoveryOptions = {},
): Promise<RunSummary> {
  const { db } = openDatabase(baseDir);
  const config = loadConfig(baseDir);
  const { profile } = loadProfile(baseDir);
  const sourceBreakdown: Record<string, number> = {};
  const context = options.context;

  const providers = getSearchProviders();
  const searchQueries = filterQueries(baseDir, options.lane, options.companyWatchOnly);
  const gathered = await gatherSearchCandidates(searchQueries, providers, deps, config);
  Object.entries(gathered.sourceBreakdown).forEach(([key, value]) => sourceBreakdownAccumulator(sourceBreakdown, key, value));
  if (context) {
    context.sourceBreakdown = sourceBreakdown;
  }

  const directListings = await collectConfiguredListings(config, deps, options, sourceBreakdown);

  const initialCandidates = gathered.candidates.map(classifyCandidate);
  let deduped = gathered.deduped;
  const queue: DiscoveryCandidate[] = [...initialCandidates];
  const seen = new Set(initialCandidates.map((candidate) => candidate.normalizedUrl));
  const domainBudgets = new Map<string, number>();

  enqueueDiscoveryCandidates(db, initialCandidates);

  let totalNew = 0;
  let totalUpdated = 0;
  let excluded = 0;
  let companiesTouched = 0;
  let contactsTouched = 0;
  let totalDiscovered = directListings.length + initialCandidates.length;
  let parsed = 0;
  let fetchAttempts = 0;
  let fetchSuccesses = 0;
  let jsFallbacks = 0;
  let actionableCount = 0;
  let applyNowCount = 0;
  let coldEmailCount = 0;
  let enrichFirstCount = 0;
  let watchCount = 0;
  let discardCount = 0;
  let directContactCompanies = 0;
  let founderSurfaceCompanies = 0;
  let totalOutreachLeverageScore = 0;
  const directContactCompanyKeys = new Set<string>();
  const founderSurfaceCompanyKeys = new Set<string>();

  const processListing = (listing: (typeof directListings)[number]) => {
    if (isCompanyWatchLane(config, listing.lane) && !listing.isRealJobPage) {
      const companyUrl = listing.companyUrl || listing.url;
      const companyInput: CompanyRecordInput = {
        canonicalKey: canonicalCompanyKey(listing.company || listing.title || domainFromUrl(companyUrl), domainFromUrl(companyUrl)),
        name: listing.company || listing.title,
        domain: domainFromUrl(companyUrl),
        location: listing.location,
        companyUrl,
        careersUrl: listing.careersUrl || `${companyUrl.replace(/\/$/, "")}/jobs`,
        aboutUrl: listing.aboutUrl || companyUrl,
        teamUrl: listing.teamUrl,
        contactUrl: listing.contactUrl || companyUrl,
        pressUrl: listing.pressUrl,
        linkedinUrl: listing.companyLinkedinUrl,
        description: listing.description,
        sourceUrls: listing.sourceUrls,
        publicContacts: listing.publicContacts.map((contact) => contact.email || contact.linkedinUrl || contact.sourceUrl),
        startupSignals: [/startup|early stage|growth stage|seed|series a|founding/i.test(listing.description) ? "startup_language" : ""].filter(Boolean),
        hiringSignals: [/actively hiring|open roles|view jobs|we're hiring|we are hiring/i.test(listing.description) ? "hiring_language" : ""].filter(Boolean),
        founderNames: [],
        cities: listing.location ? [listing.location] : [],
        sizeBand: "",
        stageText: /early stage|growth stage|seed|series a|founding/i.test(listing.description) ? "startup signal" : "",
        remotePolicy: listing.workModel === "remote" ? "remote-friendly" : "",
        openRoleCount: /open roles|view jobs|job opening|apply now|we're hiring|we are hiring/i.test(listing.description) ? 1 : 0,
        startupScore: /startup|early stage|growth stage|seed|series a|founding/i.test(listing.description) ? 10 : 0,
        companyFitScore: 8,
        hiringSignalScore: /actively hiring|open roles|view jobs|we're hiring|we are hiring/i.test(listing.description) ? 8 : 0,
        contactabilityScore: listing.publicContacts.some((contact) => contact.email) ? 8 : 0,
        isStartupCandidate: /startup|early stage|growth stage|seed|series a|founding/i.test(listing.description),
        lastSeenAt: new Date().toISOString(),
      };
      upsertCompany(db, companyInput);
      companiesTouched += 1;
      return;
    }

    const scored = scoreListing(config, profile, { ...listing, titleFamily: normalizeTitleFamily(config, listing.lane, listing.title) });
    const decision = buildDecisionSnapshot(listing, profile, scored.score, scored.breakdown, scored.eligibility);
    const result = upsertJob(
      db,
      config,
      { ...listing, titleFamily: scored.titleFamily },
      scored.score,
      scored.category,
      scored.rationale,
      scored.relevantProjects,
      profile,
      scored.breakdown,
      scored.eligibility,
      decision,
    );
    totalNew += Number(result.inserted);
    totalUpdated += Number(result.updated);
    excluded += Number(result.excluded);
    companiesTouched += Number(result.companyTouched);
    contactsTouched += result.contactsTouched;
    totalOutreachLeverageScore += decision.outreachLeverageScore;
    if (decision.recommendation === "apply_now") applyNowCount += 1;
    else if (decision.recommendation === "cold_email") coldEmailCount += 1;
    else if (decision.recommendation === "enrich_first") enrichFirstCount += 1;
    else if (decision.recommendation === "watch") watchCount += 1;
    else if (decision.recommendation === "discard") discardCount += 1;
    if (decision.recommendation !== "discard" && decision.recommendation !== "watch") actionableCount += 1;
    const companyKey = canonicalCompanyKey(listing.company, domainFromUrl(listing.companyUrl || listing.url));
    if (listing.publicContacts.some((contact) => contact.email)) directContactCompanyKeys.add(companyKey);
    if (listing.teamUrl || listing.aboutUrl || listing.contactUrl) founderSurfaceCompanyKeys.add(companyKey);
  };

  for (const listing of directListings) {
    processListing(listing);
  }

  const jobCandidates = initialCandidates.filter((candidate) => !isCompanyWatchLane(config, candidate.lane));
  const expandedSearchListings = await mapLimit(jobCandidates, config.search.pageFetchConcurrency, async (candidate) => {
    fetchAttempts += 1;
    try {
      const listings = await withRetries(
        () =>
          expandSearchResult(
            {
              lane: candidate.lane,
              title: candidate.title,
              url: candidate.url,
              snippet: candidate.snippet,
              source: "search",
              query: candidate.query ?? "",
              provider: candidate.source,
            },
            deps,
            config,
          ),
        config.search.retries,
      );
      fetchSuccesses += 1;
      parsed += 1;
      return listings;
    } catch {
      context?.warnings.push(`Search expansion failed for ${candidate.url}`);
      return [];
    }
  });
  for (const listing of expandedSearchListings.flat()) {
    processListing(listing);
  }

  let currentBatch = initialCandidates.filter((candidate) => isCompanyWatchLane(config, candidate.lane));
  while (currentBatch.length) {
    const results = await mapLimit(currentBatch, config.search.pageFetchConcurrency, async (candidate) => {
      const domain = candidate.domain || domainFromUrl(candidate.url);
      const domainCount = domainBudgets.get(domain) ?? 0;
      if (domain && domainCount >= config.search.maxPagesPerDomainPerRun) {
        return { candidate, skipped: true as const };
      }
      domainBudgets.set(domain, domainCount + 1);
      fetchAttempts += 1;

      try {
        const outcome = await withRetries(
          () => crawlUrl(candidate.url, candidate.lane, candidate.sourceType, candidate.source, deps, config),
          config.search.retries,
        );
        fetchSuccesses += 1;
        parsed += 1;
        if (outcome.usedBrowserFallback) {
          jsFallbacks += 1;
        }

        upsertPageCache(db, {
          normalizedUrl: normalizeUrl(outcome.page.url),
          url: outcome.page.url,
          domain: outcome.page.domain,
          sourceType: outcome.page.sourceType,
          intent: candidate.intent,
          pageType: outcome.page.pageType,
          html: outcome.page.html,
          text: outcome.page.text,
          fetchStatus: 200,
          usedBrowserFallback: outcome.usedBrowserFallback,
        });

        markCandidateStatus(db, candidate.normalizedUrl, "done");

        return { candidate, outcome, skipped: false as const };
      } catch (error) {
        context?.errors.push(error instanceof Error ? error.message : String(error));
        markCandidateStatus(
          db,
          candidate.normalizedUrl,
          "error",
          error instanceof Error ? error.message : String(error),
        );
        return { candidate, error, skipped: false as const };
      }
    });

    const nextBatch: DiscoveryCandidate[] = [];
    for (const result of results) {
      if (result.skipped || !("outcome" in result) || !result.outcome) {
        continue;
      }

      const { candidate, outcome } = result;
      if (!outcome.listings.length && isCompanyWatchLane(config, candidate.lane)) {
        const company = buildCompanyInput(config, candidate, outcome.page.text, outcome.contacts);
        const companyId = upsertCompany(db, company);
        companiesTouched += 1;
        for (const contact of outcome.contacts) {
          upsertContact(db, {
            canonicalKey: canonicalContactKey(contact.email, contact.linkedinUrl, contact.name || outcome.page.domain, company.canonicalKey),
            companyCanonicalKey: company.canonicalKey,
            name: contact.name,
            title: contact.title,
            email: contact.email,
            sourceUrl: contact.sourceUrl,
            linkedinUrl: contact.linkedinUrl,
            contactKind: contact.kind,
            notes: contact.kind,
            confidence: contact.confidence,
            evidenceType: contact.evidenceType,
            evidenceExcerpt: contact.evidenceExcerpt,
            isPublic: contact.isPublic,
            lastVerifiedAt: new Date().toISOString(),
            pageType: contact.pageType,
            lastSeenAt: new Date().toISOString(),
          });
          contactsTouched += 1;
        }
        void companyId;
      }

      for (const listing of outcome.listings) {
        processListing(listing);
      }

      for (const childUrl of outcome.childUrls) {
        const normalizedUrl = normalizeUrl(childUrl);
        if (seen.has(normalizedUrl)) {
          deduped += 1;
          continue;
        }
        seen.add(normalizedUrl);
        const childCandidate = classifyCandidate({
          url: childUrl,
          normalizedUrl,
          sourceType: "career_page",
          lane: candidate.lane,
          intent: "job",
          query: candidate.query,
          confidence: Math.max(0.55, candidate.confidence - 0.05),
          source: candidate.source,
          discoveredAt: new Date().toISOString(),
          domain: domainFromUrl(childUrl),
          title: "",
          snippet: "",
        });
        nextBatch.push(childCandidate);
        enqueueDiscoveryCandidates(db, [childCandidate]);
        totalDiscovered += 1;
      }
    }

    currentBatch = nextBatch;
  }

  const summary = summarizeRun({
    runId: context?.runId,
    status: context?.errors.length ? "partial" : "succeeded",
    totalFound: totalDiscovered,
    totalNew,
    totalUpdated,
    excluded,
    companiesTouched,
    contactsTouched,
    deduped,
    parsed,
    fetchSuccessRate: fetchAttempts ? fetchSuccesses / fetchAttempts : 0,
    parseSuccessRate: fetchAttempts ? parsed / fetchAttempts : 0,
    jsFallbackRate: fetchAttempts ? jsFallbacks / fetchAttempts : 0,
    actionableCount,
    applyNowCount,
    coldEmailCount,
    enrichFirstCount,
    watchCount,
    discardCount,
    directContactCompanies: directContactCompanyKeys.size,
    founderSurfaceCompanies: founderSurfaceCompanyKeys.size,
    averageOutreachLeverageScore:
      applyNowCount + coldEmailCount + enrichFirstCount + watchCount + discardCount
        ? totalOutreachLeverageScore / (applyNowCount + coldEmailCount + enrichFirstCount + watchCount + discardCount)
        : 0,
    warnings: context?.warnings ?? [],
    errors: context?.errors ?? [],
  });

  recordRunMetrics(db, summary, sourceBreakdown);
  return summary;
}
