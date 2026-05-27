import { getStoredSpreadsheetId, openDatabase, saveSpreadsheetState } from "../state/db.js";
import { GoogleSheetGateway, type SheetGateway } from "../state/sheets.js";
import { loadConfig } from "../normalization/config.js";
import type { DailyReportPayload, SheetsSyncStatus } from "./daily-types.js";

type Row = Record<string, string>;

const JOB_HEADERS = [
  "run_date",
  "rank",
  "company",
  "title",
  "confidence",
  "confidence_label",
  "status",
  "location",
  "work_mode",
  "language_note",
  "recommended_action",
  "apply_url",
  "job_url",
  "source",
  "why_fit",
  "contact_route",
  "company_domain",
  "already_applied",
  "already_contacted",
  "first_seen_at",
  "last_seen_at",
  "canonical_key",
] as const;

const COMPANY_HEADERS = [
  "run_date",
  "rank",
  "company",
  "stage",
  "stage_rank",
  "size_band",
  "company_type",
  "confidence",
  "confidence_label",
  "status",
  "priority_band",
  "website",
  "location",
  "contact_route",
  "contact_type",
  "contact_quality",
  "best_next_step",
  "source",
  "why_fit",
  "already_contacted",
  "already_applied",
  "first_seen_at",
  "last_seen_at",
  "canonical_domain",
] as const;

function toJobRow(runDate: string, item: DailyReportPayload["jobs"][number]): Row {
  return {
    run_date: runDate,
    rank: String(item.rank),
    status: item.state,
    confidence: String(item.confidence),
    confidence_label: item.confidenceLabel,
    company: item.company,
    title: item.title,
    location: item.location,
    work_mode: item.workModel,
    language_note: item.languageNote,
    recommended_action: item.recommendedRoute,
    job_url: item.jobUrl,
    apply_url: item.applyUrl,
    source: item.source,
    why_fit: item.whyFit,
    contact_route: item.recommendedRoute,
    company_domain: item.companyDomain,
    already_applied: String(item.state === "applied"),
    already_contacted: String(item.state === "contacted"),
    first_seen_at: item.firstSeenAt,
    last_seen_at: item.lastSeenAt,
    canonical_key: item.canonicalKey,
  };
}

function toCompanyRow(runDate: string, item: DailyReportPayload["companies"][number]): Row {
  return {
    run_date: runDate,
    rank: String(item.rank),
    status: item.state,
    confidence: String(item.confidence),
    confidence_label: item.confidenceLabel,
    company: item.company,
    stage: item.stage,
    stage_rank: String(item.stageRank),
    size_band: item.sizeBand,
    website: item.website,
    location: item.location,
    company_type: item.companyType,
    contact_route: item.contactRoute,
    contact_type: item.contactType,
    contact_quality: item.contactQuality,
    best_next_step:
      item.contactType === "hiring_email" || item.contactType === "public_email" || item.contactType === "generic_email"
        ? "Send concise intro email"
        : item.contactType === "team_page" || item.contactType === "linkedin"
          ? "Find best person and send short advice-fit note"
          : "Open contact route and qualify before emailing",
    source: item.source,
    why_fit: item.whyFit,
    already_contacted: String(item.state === "contacted"),
    already_applied: String(item.state === "applied"),
    first_seen_at: item.firstSeenAt,
    last_seen_at: item.lastSeenAt,
    canonical_domain: item.canonicalDomain,
  };
}

function asNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function boolWeight(value: string): number {
  return value === "true" ? 1 : 0;
}

function statusWeight(value: string): number {
  switch (value) {
    case "applied":
      return 4;
    case "contacted":
      return 3;
    case "talking":
      return 2;
    case "found":
      return 1;
    default:
      return 0;
  }
}

function dedupeRows(rows: Row[], keySelector: (row: Row) => string): Row[] {
  const deduped = new Map<string, Row>();
  for (const row of rows) {
    const key = keySelector(row).trim();
    if (!key) continue;
    if (!deduped.has(key)) {
      deduped.set(key, row);
    }
  }
  return [...deduped.values()];
}

function sortJobRows(rows: Row[]): Row[] {
  return [...rows].sort((left, right) => {
    const appliedDelta = boolWeight(right.already_applied) - boolWeight(left.already_applied);
    if (appliedDelta !== 0) return appliedDelta;
    const contactedDelta = boolWeight(right.already_contacted) - boolWeight(left.already_contacted);
    if (contactedDelta !== 0) return contactedDelta;
    const confidenceDelta = asNumber(right.confidence) - asNumber(left.confidence);
    if (confidenceDelta !== 0) return confidenceDelta;
    return asNumber(left.rank) - asNumber(right.rank);
  }).map((row, index) => ({ ...row, rank: String(index + 1) }));
}

function sortCompanyRows(rows: Row[]): Row[] {
  return [...rows].sort((left, right) => {
    const appliedDelta = boolWeight(right.already_applied) - boolWeight(left.already_applied);
    if (appliedDelta !== 0) return appliedDelta;
    const contactedDelta = boolWeight(right.already_contacted) - boolWeight(left.already_contacted);
    if (contactedDelta !== 0) return contactedDelta;
    const statusDelta = statusWeight(right.status) - statusWeight(left.status);
    if (statusDelta !== 0) return statusDelta;
    const stageDelta = asNumber(right.stage_rank) - asNumber(left.stage_rank);
    if (stageDelta !== 0) return stageDelta;
    const confidenceDelta = asNumber(right.confidence) - asNumber(left.confidence);
    if (confidenceDelta !== 0) return confidenceDelta;
    const priorityWeight = (value: string) => (value === "high" ? 3 : value === "medium" ? 2 : 1);
    return priorityWeight(right.priority_band) - priorityWeight(left.priority_band);
  }).map((row, index) => ({ ...row, rank: String(index + 1) }));
}

async function ensureSpreadsheet(baseDir: string, gateway: SheetGateway): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const { db } = openDatabase(baseDir);
  const config = loadConfig(baseDir);
  let spreadsheetId = config.sheets.spreadsheetId || getStoredSpreadsheetId(db);
  if (!spreadsheetId) {
    spreadsheetId = await gateway.createSpreadsheet("Job Sniper Recommendations", config.sheets.folderId || "");
    saveSpreadsheetState(db, spreadsheetId, { lastSyncAt: new Date().toISOString() });
  }
  return {
    spreadsheetId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
  };
}

async function resetDailySpreadsheet(spreadsheetId: string, gateway: SheetGateway): Promise<void> {
  await gateway.ensureSheet(spreadsheetId, "_RESET");
  const titles = gateway.listSheetTitles ? await gateway.listSheetTitles(spreadsheetId) : ["Jobs", "Companies"];
  for (const title of titles) {
    if (title === "_RESET") continue;
    await gateway.deleteSheet?.(spreadsheetId, title);
  }
  await gateway.ensureSheet(spreadsheetId, "Jobs");
  await gateway.ensureSheet(spreadsheetId, "Companies");
  await gateway.deleteSheet?.(spreadsheetId, "_RESET");
  await gateway.writeSheet(spreadsheetId, "Jobs", [], [...JOB_HEADERS]);
  await gateway.writeSheet(spreadsheetId, "Companies", [], [...COMPANY_HEADERS]);
}

export async function syncDailyRecommendations(
  baseDir: string,
  payload: DailyReportPayload,
  gateway?: SheetGateway,
  options: { reset?: boolean } = {},
): Promise<SheetsSyncStatus> {
  const status: SheetsSyncStatus = {
    skipped: false,
    ok: false,
    message: "",
    warnings: [],
  };
  try {
    const sheetGateway = gateway ?? new GoogleSheetGateway();
    const config = loadConfig(baseDir);
    const { spreadsheetId, spreadsheetUrl } = await ensureSpreadsheet(baseDir, sheetGateway);
    const runDate = payload.generatedAt.slice(0, 10);

    if (options.reset) {
      await resetDailySpreadsheet(spreadsheetId, sheetGateway);
    }

    await sheetGateway.ensureSheet(spreadsheetId, config.sheets.tabs.jobs || "Jobs");
    await sheetGateway.ensureSheet(spreadsheetId, config.sheets.tabs.companies || "Companies");

    const jobRows = sortJobRows(dedupeRows(payload.jobs.map((item) => toJobRow(runDate, item)), (row) => row.canonical_key || `${row.company}::${row.title}`));
    const companyRows = sortCompanyRows(
      dedupeRows(payload.companies.map((item) => toCompanyRow(runDate, item)), (row) => row.canonical_domain || row.company || row.website),
    );
    const jobsTitle = config.sheets.tabs.jobs || "Jobs";
    const companiesTitle = config.sheets.tabs.companies || "Companies";
    await sheetGateway.writeSheet(spreadsheetId, jobsTitle, jobRows, [...JOB_HEADERS]);
    await sheetGateway.writeSheet(spreadsheetId, companiesTitle, companyRows, [...COMPANY_HEADERS]);
    await sheetGateway.formatDailySheet?.(spreadsheetId, jobsTitle, { kind: "jobs", headers: [...JOB_HEADERS], rowCount: jobRows.length });
    await sheetGateway.formatDailySheet?.(spreadsheetId, companiesTitle, { kind: "companies", headers: [...COMPANY_HEADERS], rowCount: companyRows.length });

    const { db } = openDatabase(baseDir);
    saveSpreadsheetState(db, spreadsheetId, { lastSyncAt: new Date().toISOString() });
    status.ok = true;
    status.message = options.reset ? "Reset and synced Jobs and Companies tabs." : "Synced Jobs and Companies tabs.";
    status.spreadsheetUrl = spreadsheetUrl;
    return status;
  } catch (error) {
    status.ok = false;
    status.message = error instanceof Error ? error.message : String(error);
    return status;
  }
}
