import { openDatabase, startRunRecord, finishRunRecord } from "../state/db.js";
import { createDefaultDependencies } from "../lib/http.js";
import { resolveCompanyBestContact } from "../ingestion/company-enrich.js";
import { canonicalJobIdentity, normalizeCompanyDomain } from "./dedupe.js";
import { buildCompanyTypeHint, classifyLanguage, classifyLocation, classifyRole, summarizeRuleSet, toConfidenceLabel } from "./classification.js";
import { discoverDailyCandidates } from "./discovery.js";
import { importGmailAudit } from "./gmail-audit.js";
import { loadProfileContext } from "./profile-context.js";
import { syncDailyRecommendations } from "./sheets-sync.js";
import { buildDailyReportPaths, renderDailyMarkdown, writeDailyMarkdown } from "./daily-report.js";
import { writeDailyJson } from "./daily-json.js";
import type {
  CompanyRecommendation,
  DailyEngineOptions,
  DailyEngineResult,
  DailyReportPayload,
  DailySkippedItem,
  DailyState,
  JobRecommendation,
  SheetsSyncStatus,
} from "./daily-types.js";

interface JobRow {
  id: number;
  canonical_key: string;
  company_id: number | null;
  company_name: string;
  title: string;
  location: string;
  language: string;
  work_model: string;
  description: string;
  url: string;
  apply_url: string;
  source: string;
  recommendation: string;
  score: number;
  pipeline_status: string;
  posted_at: string;
  created_at: string;
  updated_at: string;
}

interface CompanyRow {
  id: number;
  canonical_key: string;
  name: string;
  domain: string;
  location: string;
  company_url: string;
  description: string;
  source_urls: string;
  public_contacts: string;
  stage_text: string;
  size_band: string;
  priority_band: string;
  startup_score: number;
  company_fit_score: number;
  contactability_score: number;
  recommendation_reason: string;
  updated_at: string;
  created_at: string;
  careers_url: string;
  team_url: string;
  contact_url: string;
  linkedin_url: string;
}

function freshnessAdjustment(isoDate: string): number {
  const timestamp = Date.parse(isoDate);
  if (Number.isNaN(timestamp)) return 0;
  const ageDays = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
  if (ageDays <= 7) return 8;
  if (ageDays <= 21) return 4;
  if (ageDays <= 45) return 0;
  if (ageDays >= 90) return -12;
  if (ageDays >= 60) return -6;
  return 0;
}

function compareByConfidenceAndFreshness(
  left: { confidence: number; lastSeenAt: string; firstSeenAt: string },
  right: { confidence: number; lastSeenAt: string; firstSeenAt: string },
): number {
  if (right.confidence !== left.confidence) return right.confidence - left.confidence;
  return Date.parse(right.lastSeenAt || right.firstSeenAt || "") - Date.parse(left.lastSeenAt || left.firstSeenAt || "");
}

const MODE_LIMITS = {
  normal: { jobs: 7, companies: 10 },
  deep: { jobs: 15, companies: 25 },
} as const;

function mapState(jobStatus: string, companyStatus: string): DailyState {
  if (jobStatus === "applied" || companyStatus === "applied") return "applied";
  if (jobStatus === "contacted" || companyStatus === "reached" || companyStatus === "sent_email" || companyStatus === "talking") return "contacted";
  return "found";
}

function parseJsonList(value: string): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function ageDays(value: string): number | null {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  return (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
}

function shouldSkipStaleLinkedInCarryover(row: Pick<JobRow, "source" | "posted_at" | "updated_at" | "title" | "company_name">): boolean {
  const isLinkedInDerived = /linkedin|brave_html/i.test(row.source);
  if (!isLinkedInDerived) return false;
  const daysOld = ageDays(row.posted_at || row.updated_at || "");
  return daysOld !== null && daysOld > 45;
}

function buildJobRecommendations(baseDir: string, skipped: DailySkippedItem[]): JobRecommendation[] {
  const { db } = openDatabase(baseDir);
  const rows = db.prepare(`
    SELECT
      j.id, j.canonical_key, j.company_id, j.company_name, j.title, j.location, j.language, j.work_model,
      j.description, j.url, j.apply_url, j.source, j.recommendation, j.score, j.pipeline_status, j.posted_at, j.created_at, j.updated_at,
      c.domain AS company_domain,
      cos.status AS company_status
    FROM jobs j
    LEFT JOIN companies c ON c.id = j.company_id
    LEFT JOIN company_outreach_state cos ON cos.company_id = j.company_id
    ORDER BY j.score DESC, j.updated_at DESC
  `).all() as Array<JobRow & { company_domain?: string; company_status?: string }>;

  const deduped = new Map<string, JobRecommendation>();
  for (const row of rows) {
    if (row.recommendation === "discard") {
      skipped.push({ label: `${row.company_name} — ${row.title}`, reason: "low_confidence", details: "Job was already classified as discard during ingestion." });
      continue;
    }
    if (shouldSkipStaleLinkedInCarryover(row)) {
      skipped.push({ label: `${row.company_name} — ${row.title}`, reason: "low_confidence", details: "Stale LinkedIn carryover older than 45 days." });
      continue;
    }
    const role = classifyRole(row.title, row.description);
    if (!role.accepted) {
      skipped.push({ label: `${row.company_name} — ${row.title}`, reason: /senior|principal|director|head/.test(row.title.toLowerCase()) ? "senior_role" : "low_confidence", details: role.rejectReason ?? "role rejected" });
      continue;
    }
    const location = classifyLocation(row.location, row.work_model, row.description);
    if (!location.accepted) {
      skipped.push({ label: `${row.company_name} — ${row.title}`, reason: "bad_location", details: location.rejectReason ?? "location rejected" });
      continue;
    }
    const language = classifyLanguage(row.language, row.description);
    if (!language.accepted) {
      skipped.push({ label: `${row.company_name} — ${row.title}`, reason: "german_required", details: language.rejectReason ?? "language rejected" });
      continue;
    }
    const combined = summarizeRuleSet([role, location, language]);
    const state = mapState(row.pipeline_status, row.company_status ?? "");
    if (row.pipeline_status === "rejected" || row.pipeline_status === "archived" || row.company_status === "rejected" || row.company_status === "archived") {
      skipped.push({ label: `${row.company_name} — ${row.title}`, reason: "low_confidence", details: "Already rejected or archived." });
      continue;
    }
    if (state === "applied") {
      skipped.push({ label: `${row.company_name} — ${row.title}`, reason: "already_applied", details: "Already applied in SQLite or Gmail audit." });
      continue;
    }
    if (state === "contacted") {
      skipped.push({ label: `${row.company_name} — ${row.title}`, reason: "already_contacted", details: "Already contacted in SQLite or Gmail audit." });
      continue;
    }
    const domain = normalizeCompanyDomain({
      domain: row.company_domain,
      applyUrl: row.apply_url,
      jobUrl: row.url,
    });
    const key = canonicalJobIdentity({
      companyDomain: domain,
      companyName: row.company_name,
      title: row.title,
      applyUrl: row.apply_url,
      jobUrl: row.url,
      source: row.source,
    });
    const confidence = Math.max(
      0,
      Math.min(
        100,
        Math.round((combined.score * 0.7) + Math.min(Number(row.score || 0), 100) * 0.3 + freshnessAdjustment(row.updated_at || "")),
      ),
    );
    const recommendation: JobRecommendation = {
      rank: 0,
      canonicalKey: row.canonical_key || key,
      state,
      confidence,
      confidenceLabel: toConfidenceLabel(confidence),
      company: row.company_name,
      companyDomain: domain,
      title: row.title,
      location: row.location,
      workModel: row.work_model,
      languageNote: language.reasons[0] ?? language.warnings[0] ?? "",
      jobUrl: row.url,
      applyUrl: row.apply_url || row.url,
      source: row.source,
      recommendedRoute: "apply",
      whyFit: [...combined.reasons, "Direct application route is available."].join(" "),
      reasons: combined.reasons,
      warnings: combined.warnings,
      firstSeenAt: row.created_at,
      lastSeenAt: row.updated_at,
    };
    const existing = deduped.get(key);
    if (!existing || existing.confidence < recommendation.confidence) {
      if (existing) {
        skipped.push({ label: `${row.company_name} — ${row.title}`, reason: "duplicate", details: "Duplicate job merged into stronger row." });
      }
      deduped.set(key, recommendation);
    }
  }

  return [...deduped.values()].sort(compareByConfidenceAndFreshness);
}

function companyContactRoute(row: CompanyRow): { route: string; type: CompanyRecommendation["contactType"]; quality: string } {
  const bestContact = resolveCompanyBestContact(row as unknown as Record<string, unknown>);
  if (!bestContact) {
    return { route: "", type: "linkedin", quality: "low" };
  }
  if (bestContact.includes("@")) {
    if (/jobs@|careers@/i.test(bestContact)) return { route: bestContact, type: "hiring_email", quality: "high" };
    if (/hello@|contact@/i.test(bestContact)) return { route: bestContact, type: "generic_email", quality: "medium" };
    return { route: bestContact, type: "public_email", quality: "high" };
  }
  if (/linkedin\.com/i.test(bestContact)) return { route: bestContact, type: "linkedin", quality: "low" };
  if (/team/i.test(bestContact)) return { route: bestContact, type: "team_page", quality: "medium" };
  return { route: bestContact, type: "contact_form", quality: "medium" };
}

function companyStageRank(stageText: string): number {
  const stage = stageText.toLowerCase();
  if (stage === "pre-seed") return 6;
  if (stage === "seed" || stage === "early") return 5;
  if (stage === "series a") return 4;
  if (stage === "series b" || stage === "funded") return 3;
  if (stage === "growth") return 2;
  return 1;
}

function isPortfolioOnlyCompany(row: CompanyRow): boolean {
  const sources = parseJsonList(row.source_urls);
  return (
    sources.some((url) => /project-a\.vc/i.test(url)) &&
    !sources.some((url) => /handpickedberlin|tech\.eu|eu-startups/i.test(url))
  );
}

function buildCompanyRecommendations(baseDir: string, skipped: DailySkippedItem[]): CompanyRecommendation[] {
  const { db } = openDatabase(baseDir);
  const rows = db.prepare(`
    SELECT
      c.*, cos.status AS company_status
    FROM companies c
    LEFT JOIN company_outreach_state cos ON cos.company_id = c.id
    ORDER BY c.startup_score DESC, c.contactability_score DESC, c.updated_at DESC
  `).all() as Array<CompanyRow & { company_status?: string }>;
  const deduped = new Map<string, CompanyRecommendation>();

  for (const row of rows) {
    const domain = normalizeCompanyDomain({ domain: row.domain, website: row.company_url });
    const state = mapState("", row.company_status ?? "");
    if (row.company_status === "rejected" || row.company_status === "archived") {
      skipped.push({ label: row.name, reason: "low_confidence", details: "Company already rejected or archived." });
      continue;
    }
    if (state === "applied") {
      skipped.push({ label: row.name, reason: "already_applied", details: "Company already marked applied." });
      continue;
    }
    if (state === "contacted") {
      skipped.push({ label: row.name, reason: "already_contacted", details: "Company already contacted." });
      continue;
    }
    if (isPortfolioOnlyCompany(row)) {
      skipped.push({ label: row.name, reason: "low_confidence", details: "VC portfolio lead still needs Berlin/funding confirmation from a stronger source." });
      continue;
    }
    const location = classifyLocation(row.location, "", row.description);
    if (!location.accepted && row.location) {
      skipped.push({ label: row.name, reason: "bad_location", details: location.rejectReason ?? "company location outside scope" });
      continue;
    }
    const contact = companyContactRoute(row);
    if (!contact.route) {
      skipped.push({ label: row.name, reason: "no_contact_route", details: "No public contact route available." });
      continue;
    }
    const companyType = buildCompanyTypeHint(row.name, row.description);
    const stage = row.stage_text || "";
    const stageScore = companyStageRank(stage);
    const confidence = Math.max(
      40,
      Math.min(
        100,
        Math.round(
          location.score * 0.25 +
          stageScore * 4 +
          Math.min(Number(row.startup_score || 0) * 4, 30) +
          Math.min(Number(row.contactability_score || 0) * 3, 30) +
          Math.min(Number(row.company_fit_score || 0) * 2, 15) +
          freshnessAdjustment(row.updated_at || row.created_at || ""),
        ),
      ),
    );
    const recommendation: CompanyRecommendation = {
      rank: 0,
      canonicalDomain: domain || row.canonical_key,
      state,
      confidence,
      confidenceLabel: toConfidenceLabel(confidence),
      company: row.name,
      website: row.company_url || (domain ? `https://${domain}` : ""),
      location: row.location,
      companyType,
      contactRoute: contact.route,
      contactType: contact.type,
      contactQuality: contact.quality,
      source: parseJsonList(row.source_urls)[0] ?? row.company_url,
      stage,
      sizeBand: row.size_band || "",
      priorityBand: row.priority_band || (stageScore >= 5 ? "high" : stageScore >= 3 ? "medium" : "low"),
      stageRank: stageScore,
      whyFit: [
        location.reasons[0] ?? "Germany-adjacent company",
        stage ? `Recent ${stage} funding or stage signal keeps this early enough for a proactive outreach angle.` : "Funding and startup signals suggest a useful proactive outreach target.",
        companyType === "startup" ? "Startup context fits a hands-on designer-builder pitch." : "Company looks relevant for product design and AI-assisted prototyping.",
        `Public contact route is available via ${contact.type.replace(/_/g, " ")}.`,
      ].join(" "),
      reasons: location.reasons,
      warnings: location.warnings,
      firstSeenAt: row.created_at,
      lastSeenAt: row.updated_at,
    };
    const existing = deduped.get(recommendation.canonicalDomain);
    if (!existing || existing.confidence < recommendation.confidence) {
      if (existing) {
        skipped.push({ label: row.name, reason: "duplicate", details: "Duplicate company merged into stronger row." });
      }
      deduped.set(recommendation.canonicalDomain, recommendation);
    }
  }

  return [...deduped.values()].sort(compareByConfidenceAndFreshness);
}

function summarizePayload(payload: DailyReportPayload): string {
  return [
    `Daily sourcing complete.`,
    `Mode: ${payload.mode}`,
    `Jobs: ${payload.jobs.length} | Companies: ${payload.companies.length}`,
    `Skipped: applied ${payload.summary.alreadyAppliedSkipped}, contacted ${payload.summary.alreadyContactedSkipped}, duplicates ${payload.summary.duplicatesRemoved}`,
    `Markdown: ${payload.reportPath}`,
    `JSON: ${payload.jsonPath}`,
    payload.sheets.skipped ? "Sheets: skipped" : payload.sheets.ok ? `Sheets: ${payload.sheets.spreadsheetUrl ?? payload.sheets.message}` : `Sheets: ${payload.sheets.message}`,
  ].join("\n");
}

function cleanStaleDailyRuns(baseDir: string): void {
  const { db } = openDatabase(baseDir);
  db.prepare(`
    UPDATE runs
    SET status = 'failed',
        finished_at = datetime('now'),
        errors_json = '["Recovered stale running daily run during next startup."]',
        updated_at = datetime('now')
    WHERE status = 'running' AND mode LIKE 'daily_%'
  `).run();
}

async function runEngineOnce(baseDir: string, options: DailyEngineOptions, autoDeepTriggered: boolean): Promise<DailyEngineResult> {
  const deps = options.deps ?? createDefaultDependencies();
  cleanStaleDailyRuns(baseDir);
  const { db } = openDatabase(baseDir);
  const runId = startRunRecord(db, { mode: `daily_${options.mode}` });
  const generatedAt = deps.now().toISOString();

  try {
    const { profile, status: profileCache } = await loadProfileContext(baseDir, deps, Boolean(options.refreshProfile));
    void profile;
    const gmailAudit = importGmailAudit(baseDir);
    const discovery = await discoverDailyCandidates(baseDir, deps, options);
    const skipped: DailySkippedItem[] = [];
    const limitJobs = options.jobsLimit ?? MODE_LIMITS[options.mode].jobs;
    const limitCompanies = options.companiesLimit ?? MODE_LIMITS[options.mode].companies;
    const jobs = buildJobRecommendations(baseDir, skipped)
      .filter((job) => job.confidence >= 50)
      .slice(0, limitJobs)
      .map((job, index) => ({ ...job, rank: index + 1 }));
    const companies = buildCompanyRecommendations(baseDir, skipped)
      .filter((company) => company.confidence >= 50)
      .slice(0, limitCompanies)
      .map((company, index) => ({ ...company, rank: index + 1 }));

    let sheets: SheetsSyncStatus = {
      skipped: Boolean(options.noSheet),
      ok: false,
      message: options.noSheet ? "Skipped by flag." : "",
      warnings: [],
    };
    const { markdownPath, jsonPath } = buildDailyReportPaths(baseDir, generatedAt);
    const payload: DailyReportPayload = {
      generatedAt,
      mode: options.mode,
      profileCache,
      gmailAudit,
      sheets,
      summary: {
        jobsRecommended: jobs.length,
        companiesRecommended: companies.length,
        alreadyAppliedSkipped: skipped.filter((item) => item.reason === "already_applied").length,
        alreadyContactedSkipped: skipped.filter((item) => item.reason === "already_contacted").length,
        duplicatesRemoved: skipped.filter((item) => item.reason === "duplicate").length,
        autoDeepTriggered,
      },
      jobs,
      companies,
      skipped,
      discovery,
      reportPath: markdownPath,
      jsonPath,
    };

    if (!options.noSheet) {
      sheets = options.hooks?.syncSheets
        ? await options.hooks.syncSheets(baseDir, payload)
        : await syncDailyRecommendations(baseDir, payload, undefined, { reset: options.resetSheet });
      payload.sheets = sheets;
    }

    const markdown = renderDailyMarkdown(payload);
    writeDailyMarkdown(markdownPath, markdown);
    const json = writeDailyJson(jsonPath, payload);

    finishRunRecord(db, runId, {
      status: "succeeded",
      sourceBreakdown: Object.fromEntries(payload.discovery.sourcesAttempted.map((source) => [source, 1])),
      warnings: [...payload.discovery.warnings, ...payload.gmailAudit.warnings, ...payload.profileCache.warnings, ...payload.sheets.warnings],
      errors: payload.sheets.ok || payload.sheets.skipped ? [] : [payload.sheets.message],
      artifacts: [markdownPath, jsonPath],
      summary: {
        totalFound: jobs.length + companies.length,
        totalNew: jobs.length + companies.length,
        totalUpdated: 0,
        deduped: payload.summary.duplicatesRemoved,
        parsed: jobs.length + companies.length,
        excluded: skipped.length,
        companiesTouched: companies.length,
        contactsTouched: companies.length,
        actionableCount: jobs.length + companies.length,
        applyNowCount: jobs.length,
        coldEmailCount: companies.length,
        enrichFirstCount: 0,
        watchCount: 0,
        discardCount: skipped.length,
        directContactCompanies: companies.filter((company) => company.contactRoute.includes("@")).length,
        founderSurfaceCompanies: companies.filter((company) => company.contactType === "team_page" || company.contactType === "linkedin").length,
        averageOutreachLeverageScore: 0,
        fetchSuccessRate: 0,
        parseSuccessRate: 0,
        jsFallbackRate: 0,
      },
    });

    return { payload, markdown, json };
  } catch (error) {
    finishRunRecord(db, runId, {
      status: "failed",
      sourceBreakdown: {},
      warnings: [],
      errors: [error instanceof Error ? error.message : String(error)],
      artifacts: [],
      summary: {
        totalFound: 0,
        totalNew: 0,
        totalUpdated: 0,
        deduped: 0,
        parsed: 0,
        excluded: 0,
        companiesTouched: 0,
        contactsTouched: 0,
        actionableCount: 0,
        applyNowCount: 0,
        coldEmailCount: 0,
        enrichFirstCount: 0,
        watchCount: 0,
        discardCount: 0,
        directContactCompanies: 0,
        founderSurfaceCompanies: 0,
        averageOutreachLeverageScore: 0,
        fetchSuccessRate: 0,
        parseSuccessRate: 0,
        jsFallbackRate: 0,
      },
    });
    throw error;
  }
}

export async function runDailyEngine(baseDir: string, options: DailyEngineOptions): Promise<DailyEngineResult> {
  const initial = await runEngineOnce(baseDir, options, false);
  if (
    options.mode === "normal" &&
    !options.noAutoDeep &&
    (initial.payload.jobs.length < 2 || initial.payload.companies.length < 2)
  ) {
    return runEngineOnce(baseDir, { ...options, mode: "deep" }, true);
  }
  return initial;
}

export function presentDailyResult(result: DailyEngineResult, emitJson = false): string {
  if (emitJson) return result.json;
  return summarizePayload(result.payload);
}
