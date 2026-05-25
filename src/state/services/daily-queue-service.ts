import { loadConfig } from "../../normalization/config.js";
import { loadProfile } from "../../normalization/profile.js";
import { buildQueryPacks } from "../../normalization/query-packs.js";
import { runDiscovery } from "../../ingestion/search/discovery.js";
import { createDefaultDependencies } from "../../lib/http.js";
import { canonicalCompanyKey, domainFromUrl } from "../../lib/url.js";
import { openDatabase } from "../db.js";
import { buildExclusionSet, isExcluded } from "./exclusion-service.js";
import type {
  DailyQueueCompanyItem,
  DailyQueueJobItem,
  DailyQueueResult,
  Dependencies,
  PipelineContext,
} from "../../types.js";

export interface DailyQueueOptions {
  limitJobs?: number;
  limitCompanies?: number;
  dryRun?: boolean;
}

export async function runDailyQueue(
  baseDir: string,
  deps: Dependencies = createDefaultDependencies(),
  options: DailyQueueOptions = {},
): Promise<DailyQueueResult> {
  const config = loadConfig(baseDir);
  const { profile } = loadProfile(baseDir);
  const { db } = openDatabase(baseDir);
  const exclusionSet = buildExclusionSet(baseDir);
  const queryPacks = buildQueryPacks(config);

  const packSummary: DailyQueueResult["queryPackSummary"] = [];
  const jobItems: DailyQueueJobItem[] = [];
  const companyItems: DailyQueueCompanyItem[] = [];
  let excludedAlreadyInDb = 0;
  let excludedAlreadyActedOn = 0;
  let excludedHuman = 0;
  let excludedLowScore = 0;
  let excludedNegativeTerm = 0;

  if (!options.dryRun) {
    // Run discovery for each enabled lane
    const runLanes = new Set<string>();
    for (const pack of queryPacks) {
      if (runLanes.has(pack.lane)) continue;
      runLanes.add(pack.lane);

      const context: PipelineContext = {
        runId: 0,
        lane: pack.lane,
        configSnapshot: config,
        profileSnapshot: profile,
        sourceBreakdown: {},
        warnings: [],
        errors: [],
      };

      try {
        await runDiscovery(baseDir, deps, { lane: pack.lane, context });
      } catch {
        // Continue with whatever was discovered before failure
      }

      const packQueries = pack.positiveTerms.length * pack.locationFilters.length;
      packSummary.push({ packId: pack.id, queried: Math.min(packQueries, config.search.maxQueriesPerLane), returned: 0 });
    }
  } else {
    for (const pack of queryPacks) {
      packSummary.push({ packId: pack.id, queried: 0, returned: 0 });
    }
  }

  // In dry-run mode, summarize from canonical DB state without crawling.
  // Otherwise, narrow to recently updated rows so the queue reflects the latest discovery run.
  const jobWindowClause = options.dryRun ? "1=1" : "datetime(j.updated_at) > datetime('now', '-30 minutes')";
  const companyWindowClause = options.dryRun ? "1=1" : "datetime(c.updated_at) > datetime('now', '-30 minutes')";

  const recentJobs = db.prepare(`
    SELECT j.* FROM jobs j
    WHERE ${jobWindowClause}
    ORDER BY j.score DESC
  `).all() as Array<Record<string, unknown>>;

  const recentCompanies = db.prepare(`
    SELECT c.* FROM companies c
    WHERE ${companyWindowClause}
    ORDER BY c.startup_score DESC, c.contactability_score DESC
  `).all() as Array<Record<string, unknown>>;

  // Build outreach state lookup
  const outreachRows = db.prepare(`SELECT company_id, status FROM company_outreach_state`).all() as Array<{ company_id: number; status: string }>;
  const outreachByCompanyId = new Map<number, string>();
  for (const row of outreachRows) {
    outreachByCompanyId.set(row.company_id, row.status);
  }

  for (const row of recentJobs) {
    const url = String(row.url ?? "");
    const companyName = String(row.company_name ?? "");
    const title = String(row.title ?? "");
    const domain = domainFromUrl(url);
    const canonicalKey = String(row.canonical_key ?? canonicalCompanyKey(companyName, domain));
    const score = Number(row.score ?? 0);
    const recommendation = String(row.recommendation ?? "watch");
    const pipelineStatus = String(row.pipeline_status ?? "discovered");

    // Count DB-state exclusions first
    if (pipelineStatus !== "discovered") {
      excludedAlreadyInDb += 1;
      continue;
    }
    if (recommendation === "discard") {
      excludedAlreadyInDb += 1;
      continue;
    }

    if (score < config.search.minScoreThreshold) {
      excludedLowScore += 1;
      continue;
    }

    if (isExcluded(exclusionSet, canonicalKey, companyName, domain, url)) {
      excludedAlreadyActedOn += 1;
      continue;
    }

    const existingId = row.id ? Number(row.id) : undefined;

    jobItems.push({
      type: "job",
      id: existingId,
      canonicalKey,
      title,
      companyName,
      url,
      score,
      recommendation: recommendation as DailyQueueJobItem["recommendation"],
      recommendedRoute: String(row.recommended_route ?? "no_action") as DailyQueueJobItem["recommendedRoute"],
      reason: `${recommendation} | score ${Math.round(score)}`,
      isNew: true,
      lastSeenAt: String(row.last_seen_at ?? row.updated_at ?? new Date().toISOString()),
    });
  }

  for (const row of recentCompanies) {
    const url = String(row.company_url ?? "");
    const name = String(row.name ?? "");
    const domain = String(row.domain ?? "");
    const canonicalKey = String(row.canonical_key ?? canonicalCompanyKey(name, domain));
    const startupScore = Number(row.startup_score ?? 0);
    const contactabilityScore = Number(row.contactability_score ?? 0);
    const companyId = row.id ? Number(row.id) : undefined;
    const outreachStatus = companyId ? outreachByCompanyId.get(companyId) : undefined;

    // Count DB-state exclusions first
    if (outreachStatus && outreachStatus !== "new") {
      excludedAlreadyInDb += 1;
      continue;
    }

    if (startupScore < 8 && contactabilityScore < 8) {
      excludedLowScore += 1;
      continue;
    }

    if (isExcluded(exclusionSet, canonicalKey, name, domain, url)) {
      excludedAlreadyActedOn += 1;
      continue;
    }

    const existingId = row.id ? Number(row.id) : undefined;

    companyItems.push({
      type: "company",
      id: existingId,
      canonicalKey,
      name,
      domain,
      url,
      startupScore,
      contactabilityScore,
      bestRoute: String(row.best_route ?? "watch_company") as DailyQueueCompanyItem["bestRoute"],
      bestContact: String(row.contact_url ?? row.careers_url ?? row.company_url ?? ""),
      reason: `startup ${Math.round(startupScore)} | contact ${Math.round(contactabilityScore)}`,
      isNew: true,
      lastSeenAt: String(row.last_seen_at ?? row.updated_at ?? new Date().toISOString()),
    });
  }

  // Deduplicate by canonical key
  const seenJobKeys = new Set<string>();
  const dedupedJobs = jobItems.filter((item) => {
    if (seenJobKeys.has(item.canonicalKey)) return false;
    seenJobKeys.add(item.canonicalKey);
    return true;
  });

  const seenCompanyKeys = new Set<string>();
  const dedupedCompanies = companyItems.filter((item) => {
    if (seenCompanyKeys.has(item.canonicalKey)) return false;
    seenCompanyKeys.add(item.canonicalKey);
    return true;
  });

  // Sort jobs by recommendation priority then score
  const recPriority: Record<string, number> = { apply_now: 1, cold_email: 2, enrich_first: 3, watch: 4, discard: 5 };
  dedupedJobs.sort((a, b) => {
    const p = (recPriority[a.recommendation] ?? 99) - (recPriority[b.recommendation] ?? 99);
    return p !== 0 ? p : b.score - a.score;
  });

  // Sort companies by combined score
  dedupedCompanies.sort((a, b) => (b.startupScore + b.contactabilityScore) - (a.startupScore + a.contactabilityScore));

  return {
    jobs: dedupedJobs.slice(0, options.limitJobs ?? 10),
    companies: dedupedCompanies.slice(0, options.limitCompanies ?? 10),
    excluded: {
      alreadyInDb: excludedAlreadyInDb,
      alreadyActedOn: excludedAlreadyActedOn,
      humanExcluded: excludedHuman,
      lowScore: excludedLowScore,
      negativeTermMatch: excludedNegativeTerm,
    },
    generatedAt: new Date().toISOString(),
    queryPackSummary: packSummary,
  };
}
