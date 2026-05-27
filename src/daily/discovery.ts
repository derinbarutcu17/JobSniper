import { mapLimit, withTimeout } from "../lib/async.js";
import { domainFromUrl } from "../lib/url.js";
import { discoverFromAtsBoard } from "../ingestion/search/ats.js";
import { discoverFromJobBoard } from "../ingestion/search/job-boards.js";
import { discoverFromRss } from "../ingestion/search/rss.js";
import { buildDecisionSnapshot } from "../normalization/decision.js";
import { loadConfig } from "../normalization/config.js";
import { earlyFilterListing } from "../normalization/listing-filter.js";
import { loadProfile } from "../normalization/profile.js";
import { isCompanyWatchLane } from "../normalization/role-packs.js";
import { scoreListing } from "../normalization/scoring.js";
import { filterKnownInvalidContacts } from "../lib/contact-memory.js";
import { openDatabase } from "../state/db.js";
import { upsertCompany, upsertContact, upsertJob } from "../state/db.js";
import type { Dependencies } from "../types.js";
import type { DailyDiscoverySummary, DailyEngineOptions } from "./daily-types.js";
import type { CompanyRecordInput, ContactCandidate, ListingCandidate, SniperConfig } from "../types.js";
import { ingestFundedBerlinStartups } from "./funded-berlin-startups.js";

const NON_COMPANY_HOST_PATTERNS = [/linkedin\.com$/i, /wellfound\.com$/i];

function isNonCompanyHost(host: string): boolean {
  return NON_COMPANY_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

function companyIdentityFromListing(listing: ListingCandidate): { domain: string; companyUrl: string } {
  const companyHost = domainFromUrl(listing.companyUrl || "");
  if (companyHost && !isNonCompanyHost(companyHost)) {
    return {
      domain: companyHost,
      companyUrl: listing.companyUrl,
    };
  }

  const jobHost = domainFromUrl(listing.url || "");
  if (jobHost && !isNonCompanyHost(jobHost)) {
    return {
      domain: jobHost,
      companyUrl: `https://${jobHost}`,
    };
  }

  return {
    domain: "",
    companyUrl: "",
  };
}

function contactabilityFromContacts(contacts: ContactCandidate[]): number {
  if (contacts.some((contact) => contact.confidence === "high")) return 16;
  if (contacts.some((contact) => contact.confidence === "medium")) return 10;
  return contacts.length ? 4 : 0;
}

function buildCompanyInput(listing: ListingCandidate): CompanyRecordInput {
  const { domain, companyUrl } = companyIdentityFromListing(listing);
  const publicContacts = filterKnownInvalidContacts(
    listing.publicContacts.map((contact) => contact.email || contact.linkedinUrl || contact.sourceUrl),
    listing.company || listing.title || "",
    domain,
  );
  const startupSignals = [/startup|seed|series a|founding|small team|0-1|studio|agency/i.test(listing.description) ? "startup_language" : ""].filter(Boolean);
  const hiringSignals = [/hiring|jobs|careers|join us|open roles/i.test(listing.description) ? "hiring_language" : ""].filter(Boolean);
  return {
    canonicalKey: `company:${(domain || listing.company).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    name: listing.company || listing.title,
    domain,
    location: listing.location,
    companyUrl: companyUrl || (domain ? `https://${domain}` : ""),
    careersUrl: listing.careersUrl || listing.url,
    aboutUrl: listing.aboutUrl,
    teamUrl: listing.teamUrl,
    contactUrl: listing.contactUrl,
    pressUrl: listing.pressUrl,
    linkedinUrl: listing.companyLinkedinUrl,
    description: listing.description,
    sourceUrls: listing.sourceUrls,
    publicContacts,
    startupSignals,
    hiringSignals,
    founderNames: [],
    cities: listing.location ? [listing.location] : [],
    sizeBand: "",
    stageText: startupSignals.length ? "startup" : "",
    remotePolicy: listing.remoteScope,
    openRoleCount: /jobs|careers|open roles|hiring/i.test(listing.description) ? 1 : 0,
    startupScore: startupSignals.length ? 10 : 0,
    companyFitScore: 8,
    hiringSignalScore: hiringSignals.length ? 8 : 0,
    contactabilityScore: contactabilityFromContacts(listing.publicContacts.filter((contact) => publicContacts.includes(contact.email || contact.linkedinUrl || contact.sourceUrl))),
    isStartupCandidate: startupSignals.length > 0,
    recommendation: "watch",
    recommendationReason: "",
    bestRoute: publicContacts.some((value) => /@/.test(value)) ? "direct_email_first" : "watch_company",
    pitchTheme: "generalist",
    pitchAngle: "",
    pitchEvidence: [],
    directContactCount: publicContacts.filter((value) => /@/.test(value)).length,
    reachableNow: publicContacts.length > 0,
    priorityBand: "medium",
    lastSeenAt: new Date().toISOString(),
  };
}

function selectLeanSources(config: SniperConfig, mode: DailyEngineOptions["mode"]) {
  const jobBoards = config.sources.jobBoards.filter((source) =>
    mode === "deep"
      ? ["linkedin", "google_jobs", "remoteok"].includes(source.provider)
      : ["linkedin", "google_jobs"].includes(source.provider),
  );
  const atsBoards = config.sources.atsBoards.filter((source) =>
    mode === "deep"
      ? ["wellfound"].includes(source.provider)
      : ["wellfound"].includes(source.provider),
  );
  const rss = config.sources.rss.filter((source) => !/design/i.test(source.name));
  return { rss, atsBoards, jobBoards };
}

async function runLeanLiveDiscovery(
  baseDir: string,
  deps: Dependencies,
  options: DailyEngineOptions,
): Promise<DailyDiscoverySummary> {
  const config = loadConfig(baseDir);
  const { profile } = loadProfile(baseDir);
  const { db } = openDatabase(baseDir);
  const warnings: string[] = [];
  const sourcesAttempted: string[] = [];
  const { rss, atsBoards, jobBoards } = selectLeanSources(config, options.mode);
  const selectedAts =
    options.mode === "deep"
      ? atsBoards
      : atsBoards.filter((source) => ["company_watch", "design_jobs"].includes(source.lane ?? "")).slice(0, 2);
  const selectedBoards = options.mode === "deep" ? jobBoards : jobBoards.slice(0, 3);

  const sourceTasks = [
    ...rss.map((source) => ({ key: `rss:${source.name}`, run: () => discoverFromRss(source, deps, config) })),
    ...selectedAts.map((source) => ({ key: `ats:${source.name}`, run: () => discoverFromAtsBoard(source, deps, config) })),
    ...selectedBoards.map((source) => ({ key: `board:${source.name}`, run: () => discoverFromJobBoard(source, deps, config) })),
  ];

  try {
    const funded = await ingestFundedBerlinStartups(baseDir, deps, config.sources.fundedBerlin, options.mode);
    warnings.push(...funded.warnings);
    sourcesAttempted.push(...funded.sourcesAttempted);
  } catch (error) {
    warnings.push(`funded_berlin_startups failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  let successfulSources = 0;
  const results = await mapLimit(sourceTasks, 2, async (task) => {
    sourcesAttempted.push(task.key);
    try {
      const listings = await withTimeout(task.run(), options.mode === "deep" ? 15000 : 10000, task.key);
      successfulSources += 1;
      return listings;
    } catch (error) {
      warnings.push(`${task.key} failed: ${error instanceof Error ? error.message : String(error)}`);
      return [] as ListingCandidate[];
    }
  });

  for (const listing of results.flat()) {
    if (isCompanyWatchLane(config, listing.lane) || !listing.isRealJobPage) {
      const companyId = upsertCompany(db, buildCompanyInput(listing));
      for (const contact of listing.publicContacts) {
        upsertContact(db, {
          canonicalKey: `contact:${(contact.email || contact.linkedinUrl || contact.sourceUrl).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          companyCanonicalKey: buildCompanyInput(listing).canonicalKey,
          name: contact.name,
          title: contact.title,
          email: contact.email,
          sourceUrl: contact.sourceUrl,
          linkedinUrl: contact.linkedinUrl,
          contactKind: contact.kind,
          notes: "daily_live_discovery",
          confidence: contact.confidence,
          evidenceType: contact.evidenceType,
          evidenceExcerpt: contact.evidenceExcerpt,
          isPublic: contact.isPublic,
          lastVerifiedAt: deps.now().toISOString(),
          pageType: contact.pageType,
          lastSeenAt: deps.now().toISOString(),
        });
      }
      void companyId;
      continue;
    }

    const earlyDecision = earlyFilterListing(config, profile, listing);
    if (!earlyDecision.keep) continue;
    const scored = scoreListing(config, profile, listing);
    const decision = buildDecisionSnapshot(listing, profile, scored.score, scored.breakdown, scored.eligibility);
    upsertJob(
      db,
      config,
      listing,
      scored.score,
      scored.category,
      scored.rationale,
      scored.relevantProjects,
      profile,
      scored.breakdown,
      scored.eligibility,
      decision,
    );
  }

  if (successfulSources === 0) {
    throw new Error(`All lean live sources failed. ${warnings[0] ?? "No successful source responses."}`);
  }

  return {
    lanes: [...new Set(results.flat().map((listing) => listing.lane))],
    warnings,
    sourcesAttempted,
  };
}

export async function discoverDailyCandidates(
  baseDir: string,
  deps: Dependencies,
  options: DailyEngineOptions,
): Promise<DailyDiscoverySummary> {
  if (options.hooks?.runDiscovery) {
    return options.hooks.runDiscovery(baseDir, options);
  }

  const { db } = openDatabase(baseDir);
  const config = loadConfig(baseDir);
  const lanes = (db.prepare("SELECT DISTINCT lane FROM jobs WHERE lane != '' ORDER BY lane").all() as Array<{ lane: string }>).map((row) => row.lane);
  const enabledLanes = Object.entries(config.lanes)
    .filter(([, lane]) => lane.enabled)
    .map(([laneId]) => laneId);

  if (process.env.SNIPER_ENABLE_LEGACY_DISCOVERY === "1") {
    const { runDiscovery } = await import("../ingestion/search/discovery.js");
    const warnings: string[] = [];
    const summary = await runDiscovery(baseDir, deps, { companyWatchOnly: false }).catch((error) => {
      warnings.push(error instanceof Error ? error.message : String(error));
      return null;
    });

    return {
      lanes: lanes.length ? lanes : enabledLanes,
      warnings: [...warnings, ...(summary?.warnings ?? [])],
      sourcesAttempted: ["legacy_discovery"],
    };
  }

  const summary = await runLeanLiveDiscovery(baseDir, deps, options);
  return {
    lanes: summary.lanes.length ? summary.lanes : lanes.length ? lanes : enabledLanes,
    warnings: summary.warnings,
    sourcesAttempted: summary.sourcesAttempted,
  };
}
