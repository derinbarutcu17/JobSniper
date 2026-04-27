import fs from "node:fs";
import { google } from "googleapis";
import { loadConfig } from "./config.js";
import { getStoredSpreadsheetId, openDatabase, saveSpreadsheetState, updateJobManualFields } from "./db.js";
import { resolveCompanyBestContact, scoreContactCandidate } from "./company-enrich.js";
import type { ContactCandidate, JobRecord, SheetSyncResult } from "./types.js";

type Row = Record<string, string>;

export interface SheetGateway {
  createSpreadsheet(title: string, folderId?: string): Promise<string>;
  ensureSheet(spreadsheetId: string, title: string): Promise<void>;
  readSheet(spreadsheetId: string, title: string): Promise<Row[]>;
  writeSheet(spreadsheetId: string, title: string, rows: Row[], headers?: string[]): Promise<void>;
  listSheetTitles?(spreadsheetId: string): Promise<string[]>;
  deleteSheet?(spreadsheetId: string, title: string): Promise<void>;
}

const JOB_HEADERS = [
  "canonical_key",
  "title",
  "title_family",
  "company_name",
  "lane",
  "source",
  "source_type",
  "is_real_job_page",
  "parse_confidence",
  "source_confidence",
  "location",
  "country",
  "language",
  "work_model",
  "employment_type",
  "posted_at",
  "last_seen_at",
  "score",
  "eligibility",
  "category",
  "recommendation",
  "recommendation_reason",
  "recommended_route",
  "route_confidence",
  "route_rationale",
  "pitch_theme",
  "pitch_angle",
  "strongest_profile_signal",
  "strongest_company_signal",
  "outreach_leverage_score",
  "interview_probability_band",
  "opportunity_cost_band",
  "company_fit_score",
  "startup_fit_score",
  "contactability_score",
  "url",
  "apply_url",
  "best_contact",
  "explanation_short",
  "manual_status",
  "priority",
  "outreach_state",
  "owner_notes",
  "manual_contact_override",
] as const;

const COMPANY_HEADERS = [
  "canonical_key",
  "name",
  "domain",
  "location",
  "recommendation",
  "recommendation_reason",
  "best_route",
  "priority_band",
  "reachable_now",
  "open_role_count",
  "direct_contact_count",
  "startup_score",
  "company_fit_score",
  "hiring_signal_score",
  "contactability_score",
  "is_startup_candidate",
  "pitch_theme",
  "pitch_angle",
  "pitch_evidence",
  "startup_signals",
  "hiring_signals",
  "founder_names",
  "stage_text",
  "size_band",
  "remote_policy",
  "company_url",
  "careers_url",
  "about_url",
  "team_url",
  "contact_url",
  "press_url",
  "linkedin_url",
  "best_contact",
  "source_urls",
  "description",
] as const;

const CONTACT_HEADERS = [
  "canonical_key",
  "company_name",
  "kind",
  "confidence",
  "name",
  "title",
  "email",
  "linkedin_url",
  "source_url",
  "page_type",
  "evidence_type",
  "evidence_excerpt",
  "is_public",
  "last_verified_at",
  "last_seen_at",
  "notes",
] as const;

const RUN_METRIC_HEADERS = [
  "run_id",
  "run_timestamp",
  "finished_at",
  "status",
  "lane",
  "mode",
  "total_discovered",
  "total_deduped",
  "total_parsed",
  "companies_discovered",
  "contacts_discovered",
  "jobs_eligible",
  "actionable_count",
  "apply_now_count",
  "cold_email_count",
  "enrich_first_count",
  "watch_count",
  "discard_count",
  "direct_contact_companies",
  "founder_surface_companies",
  "average_outreach_leverage_score",
  "fetch_success_rate",
  "parse_success_rate",
  "js_fallback_rate",
  "source_breakdown",
  "warnings",
  "errors",
  "artifacts",
] as const;

const JOB_MANUAL_COLUMNS = [
  "manual_status",
  "owner_notes",
  "priority",
  "outreach_state",
  "manual_contact_override",
] as const;

function resolveSheetSettings(baseDir: string) {
  const config = loadConfig(baseDir);
  return {
    spreadsheetId: config.sheets.spreadsheetId || process.env.SNIPER_GOOGLE_SHEET_ID || "",
    createIfMissing: config.sheets.createIfMissing,
    folderId: config.sheets.folderId || process.env.SNIPER_GOOGLE_FOLDER_ID || "",
    tabs: {
      jobs: config.sheets.tabs.jobs || process.env.SNIPER_JOBS_TAB || "Jobs",
      companies: config.sheets.tabs.companies || process.env.SNIPER_COMPANIES_TAB || "Companies",
      contacts: config.sheets.tabs.contacts || process.env.SNIPER_CONTACTS_TAB || "Contacts",
      runMetrics: config.sheets.tabs.runMetrics || process.env.SNIPER_RUN_METRICS_TAB || "RunMetrics",
      dailyJobsPrefix: config.sheets.tabs.dailyJobsPrefix || process.env.SNIPER_DAILY_JOBS_PREFIX || "Jobs ",
    },
  };
}

function getGoogleAuth() {
  const json = process.env.SNIPER_GOOGLE_SERVICE_ACCOUNT_JSON;
  const filePath = process.env.SNIPER_GOOGLE_SERVICE_ACCOUNT_PATH;

  if (!json && !filePath) {
    throw new Error(
      "Missing Google service account credentials. Set SNIPER_GOOGLE_SERVICE_ACCOUNT_JSON or SNIPER_GOOGLE_SERVICE_ACCOUNT_PATH.",
    );
  }

  const credentials = json ? JSON.parse(json) : JSON.parse(fs.readFileSync(filePath!, "utf8"));
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive",
    ],
  });
}

export class GoogleSheetGateway implements SheetGateway {
  private readonly sheets = google.sheets({ version: "v4", auth: getGoogleAuth() });
  private readonly drive = google.drive({ version: "v3", auth: getGoogleAuth() });

  async createSpreadsheet(title: string, folderId?: string): Promise<string> {
    const spreadsheet = await this.sheets.spreadsheets.create({
      requestBody: {
        properties: { title },
      },
    });
    const spreadsheetId = spreadsheet.data.spreadsheetId;
    if (!spreadsheetId) {
      throw new Error("Google Sheets create call returned no spreadsheet ID.");
    }
    if (folderId) {
      await this.drive.files.update({
        fileId: spreadsheetId,
        addParents: folderId,
      });
    }
    return spreadsheetId;
  }

  async ensureSheet(spreadsheetId: string, title: string): Promise<void> {
    const spreadsheet = await this.sheets.spreadsheets.get({ spreadsheetId });
    const exists = spreadsheet.data.sheets?.some((sheet) => sheet.properties?.title === title);
    if (exists) return;
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title } } }],
      },
    });
  }

  async listSheetTitles(spreadsheetId: string): Promise<string[]> {
    const spreadsheet = await this.sheets.spreadsheets.get({ spreadsheetId });
    return (spreadsheet.data.sheets ?? [])
      .map((sheet) => sheet.properties?.title)
      .filter((title): title is string => Boolean(title));
  }

  async deleteSheet(spreadsheetId: string, title: string): Promise<void> {
    const spreadsheet = await this.sheets.spreadsheets.get({ spreadsheetId });
    const sheet = (spreadsheet.data.sheets ?? []).find((entry) => entry.properties?.title === title);
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined) return;
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ deleteSheet: { sheetId } }],
      },
    });
  }

  async readSheet(spreadsheetId: string, title: string): Promise<Row[]> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${title}!A:ZZ`,
    });
    const values = response.data.values ?? [];
    if (!values.length) return [];
    const headers = values[0];
    if (values.length < 2) return [];
    return values.slice(1).map((row) => {
      const record: Row = {};
      headers.forEach((header, index) => {
        record[header] = row[index] ?? "";
      });
      return record;
    });
  }

  async writeSheet(spreadsheetId: string, title: string, rows: Row[], headers: string[] = []): Promise<void> {
    const resolvedHeaders = headers.length ? headers : rows.length ? Object.keys(rows[0]) : [];
    const values = [resolvedHeaders, ...rows.map((row) => resolvedHeaders.map((header) => row[header] ?? ""))];
    await this.sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${title}!A:ZZ`,
    });
    await this.sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${title}!A1`,
      valueInputOption: "RAW",
      requestBody: { values },
    });
  }
}

function shortExplanation(job: JobRecord): string {
  const positives = (() => {
    try {
      const parsed = JSON.parse(job.score_explanation_json || "{}") as { positives?: string[]; negatives?: string[] };
      const parts = [...(parsed.positives ?? []).slice(0, 2), ...(parsed.negatives ?? []).slice(0, 1)];
      return parts.join(" | ");
    } catch {
      return job.match_rationale;
    }
  })();
  return (positives || job.match_rationale || "").slice(0, 240);
}

function bestContact(job: JobRecord): string {
  if (job.manual_contact_override) return job.manual_contact_override;
  try {
    const contacts = JSON.parse(job.public_contacts || "[]") as Array<{ email?: string; linkedinUrl?: string; confidence?: string }>;
    const preferred = contacts.find((contact) => contact.email && contact.confidence === "high") ?? contacts.find((contact) => contact.email) ?? contacts[0];
    return preferred?.email || preferred?.linkedinUrl || "";
  } catch {
    return "";
  }
}

function parseJsonList(value: string, fallback: string[] = []): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry)).filter(Boolean) : fallback;
  } catch {
    return fallback;
  }
}

function scoreContactForCompany(
  company: Record<string, unknown>,
  contact: Record<string, unknown>,
): number {
  return scoreContactCandidate(String(company.domain ?? ""), {
    kind: String(contact.contact_kind ?? "contact_form") as ContactCandidate["kind"],
    name: String(contact.name ?? ""),
    title: String(contact.title ?? ""),
    email: String(contact.email ?? ""),
    linkedinUrl: String(contact.linkedin_url ?? ""),
    sourceUrl: String(contact.source_url ?? ""),
    confidence: String(contact.confidence ?? "low") as ContactCandidate["confidence"],
    evidenceType: String(contact.evidence_type ?? ""),
    evidenceExcerpt: String(contact.evidence_excerpt ?? ""),
    isPublic: true,
    pageType: String(contact.page_type ?? "generic") as ContactCandidate["pageType"],
  });
}

function jobRows(db: ReturnType<typeof openDatabase>["db"]): Row[] {
  const jobs = db
    .prepare("SELECT * FROM jobs WHERE status != 'excluded' ORDER BY score DESC, updated_at DESC")
    .all() as JobRecord[];
  return jobs.map((job) => ({
    canonical_key: job.canonical_key,
    title: job.title,
    title_family: job.title_family,
    company_name: job.company_name,
    lane: job.lane,
    source: job.source,
    source_type: job.source_type,
    is_real_job_page: String(job.is_real_job_page ?? 0),
    parse_confidence: String(job.parse_confidence ?? 0),
    source_confidence: String(job.source_confidence ?? 0),
    location: job.location,
    country: job.country,
    language: job.language,
    work_model: job.work_model,
    employment_type: job.employment_type,
    posted_at: job.posted_at,
    last_seen_at: job.last_seen_at,
    score: String(job.score),
    eligibility: job.eligibility,
    category: job.category,
    recommendation: job.recommendation || "watch",
    recommendation_reason: job.recommendation_reason || "",
    recommended_route: job.recommended_route || "no_action",
    route_confidence: String(job.route_confidence ?? 0),
    route_rationale: job.route_rationale || "",
    pitch_theme: job.pitch_theme || "",
    pitch_angle: job.pitch_angle || "",
    strongest_profile_signal: job.strongest_profile_signal || "",
    strongest_company_signal: job.strongest_company_signal || "",
    outreach_leverage_score: String(job.outreach_leverage_score ?? 0),
    interview_probability_band: job.interview_probability_band || "low",
    opportunity_cost_band: job.opportunity_cost_band || "medium",
    company_fit_score: String(job.company_fit_score ?? 0),
    startup_fit_score: String(job.startup_fit_score),
    contactability_score: String(job.contactability_score),
    url: job.url,
    apply_url: job.apply_url,
    best_contact: bestContact(job),
    explanation_short: shortExplanation(job),
    manual_status: job.manual_status || "",
    priority: job.priority || "",
    outreach_state: job.outreach_state || "",
    owner_notes: job.owner_notes || "",
    manual_contact_override: job.manual_contact_override || "",
  }));
}

function companyRows(db: ReturnType<typeof openDatabase>["db"]): Row[] {
  const companies = db
    .prepare(`
      SELECT *
      FROM companies
      ORDER BY
        CASE priority_band WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
        CASE recommendation WHEN 'cold_email' THEN 4 WHEN 'apply_now' THEN 3 WHEN 'enrich_first' THEN 2 WHEN 'watch' THEN 1 ELSE 0 END DESC,
        startup_score DESC,
        company_fit_score DESC,
        updated_at DESC
    `)
    .all() as Array<Record<string, unknown>>;
  const contacts = db
    .prepare(`
      SELECT company_id, email, linkedin_url, source_url, contact_kind, confidence
      FROM contacts
      ORDER BY
        CASE contact_kind
          WHEN 'general_contact_email' THEN 6
          WHEN 'founder_email' THEN 5
          WHEN 'recruiter_email' THEN 4
          WHEN 'application_email' THEN 3
          WHEN 'careers_email' THEN 2
          WHEN 'linkedin_person' THEN 1
          ELSE 0
        END DESC,
        CASE confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END DESC,
        updated_at DESC
    `)
    .all() as Array<Record<string, unknown>>;
  const contactsByCompanyId = new Map<number, Array<Record<string, unknown>>>();
  for (const contact of contacts) {
    const companyId = Number(contact.company_id ?? 0);
    if (!companyId) continue;
    const rows = contactsByCompanyId.get(companyId) ?? [];
    rows.push(contact);
    contactsByCompanyId.set(companyId, rows);
  }

  return companies.map((company) => ({
    canonical_key: String(company.canonical_key ?? ""),
    name: String(company.name ?? ""),
    domain: String(company.domain ?? ""),
    location: String(company.location ?? ""),
    recommendation: String(company.recommendation ?? "watch"),
    recommendation_reason: String(company.recommendation_reason ?? ""),
    best_route: String(company.best_route ?? "watch_company"),
    priority_band: String(company.priority_band ?? "low"),
    reachable_now: String(company.reachable_now ?? 0),
    open_role_count: String(company.open_role_count ?? 0),
    direct_contact_count: String(company.direct_contact_count ?? 0),
    startup_score: String(company.startup_score ?? 0),
    company_fit_score: String(company.company_fit_score ?? 0),
    hiring_signal_score: String(company.hiring_signal_score ?? 0),
    contactability_score: String(company.contactability_score ?? 0),
    is_startup_candidate: String(company.is_startup_candidate ?? 0),
    pitch_theme: String(company.pitch_theme ?? ""),
    pitch_angle: String(company.pitch_angle ?? ""),
    pitch_evidence: parseJsonList(String(company.pitch_evidence ?? "[]")).join(" | "),
    startup_signals: parseJsonList(String(company.startup_signals ?? "[]")).join(" | "),
    hiring_signals: parseJsonList(String(company.hiring_signals ?? "[]")).join(" | "),
    founder_names: parseJsonList(String(company.founder_names ?? "[]")).join(" | "),
    stage_text: String(company.stage_text ?? ""),
    size_band: String(company.size_band ?? ""),
    remote_policy: String(company.remote_policy ?? ""),
    company_url: String(company.company_url ?? ""),
    careers_url: String(company.careers_url ?? ""),
    about_url: String(company.about_url ?? ""),
    team_url: String(company.team_url ?? ""),
    contact_url: String(company.contact_url ?? ""),
    press_url: String(company.press_url ?? ""),
    linkedin_url: String(company.linkedin_url ?? ""),
    best_contact:
      (() => {
        const companyContacts = contactsByCompanyId.get(Number(company.id ?? 0)) ?? [];
        const preferred = [...companyContacts].sort(
          (left, right) => scoreContactForCompany(company, right) - scoreContactForCompany(company, left),
        )[0];
        if (preferred) {
          return String(preferred.email ?? preferred.linkedin_url ?? preferred.source_url ?? "");
        }
        return resolveCompanyBestContact(company);
      })(),
    source_urls: parseJsonList(String(company.source_urls ?? "[]")).join(" | "),
    description: String(company.description ?? ""),
  }));
}

function contactRows(db: ReturnType<typeof openDatabase>["db"]): Row[] {
  const contacts = db
    .prepare(`
      SELECT ct.*, c.name AS company_name
      FROM contacts ct
      LEFT JOIN companies c ON c.id = ct.company_id
      ORDER BY
        CASE ct.confidence WHEN 'high' THEN 4 WHEN 'medium' THEN 3 WHEN 'low' THEN 2 ELSE 1 END DESC,
        ct.updated_at DESC
    `)
    .all() as Array<Record<string, unknown>>;

  return contacts.map((contact) => ({
    canonical_key: String(contact.canonical_key ?? ""),
    company_name: String(contact.company_name ?? ""),
    kind: String(contact.contact_kind || contact.kind || (contact.email ? "general_contact_email" : contact.linkedin_url ? "linkedin_company" : "contact_form")),
    confidence: String(contact.confidence ?? ""),
    name: String(contact.name ?? ""),
    title: String(contact.title ?? ""),
    email: String(contact.email ?? ""),
    linkedin_url: String(contact.linkedin_url ?? ""),
    source_url: String(contact.source_url ?? ""),
    page_type: String(contact.page_type ?? ""),
    evidence_type: String(contact.evidence_type ?? ""),
    evidence_excerpt: String(contact.evidence_excerpt ?? ""),
    is_public: String(contact.is_public ?? 1),
    last_verified_at: String(contact.last_verified_at ?? ""),
    last_seen_at: String(contact.last_seen_at ?? ""),
    notes: String(contact.notes ?? ""),
  }));
}

function runMetricRows(db: ReturnType<typeof openDatabase>["db"]): Row[] {
  const metrics = db
    .prepare(`
      SELECT
        rm.*,
        r.status AS run_status,
        r.lane AS run_lane,
        r.mode AS run_mode,
        r.finished_at AS run_finished_at,
        r.warnings_json,
        r.errors_json,
        r.artifacts_json
      FROM run_metrics rm
      LEFT JOIN runs r ON r.id = rm.run_id
      ORDER BY rm.id DESC
      LIMIT 50
    `)
    .all() as Array<Record<string, unknown>>;

  return metrics.map((row) => ({
    run_id: String(row.run_id ?? ""),
    run_timestamp: String(row.started_at || ""),
    finished_at: String(row.run_finished_at || row.finished_at || ""),
    status: String(row.run_status || ""),
    lane: String(row.run_lane || ""),
    mode: String(row.run_mode || ""),
    total_discovered: String(row.total_discovered ?? 0),
    total_deduped: String(row.total_deduped ?? 0),
    total_parsed: String(row.total_parsed ?? 0),
    companies_discovered: String(row.companies_discovered ?? 0),
    contacts_discovered: String(row.contacts_discovered ?? 0),
    jobs_eligible: String(row.jobs_eligible ?? 0),
    actionable_count: String(row.actionable_count ?? 0),
    apply_now_count: String(row.apply_now_count ?? 0),
    cold_email_count: String(row.cold_email_count ?? 0),
    enrich_first_count: String(row.enrich_first_count ?? 0),
    watch_count: String(row.watch_count ?? 0),
    discard_count: String(row.discard_count ?? 0),
    direct_contact_companies: String(row.direct_contact_companies ?? 0),
    founder_surface_companies: String(row.founder_surface_companies ?? 0),
    average_outreach_leverage_score: String(row.average_outreach_leverage_score ?? 0),
    fetch_success_rate: String(row.fetch_success_rate ?? 0),
    parse_success_rate: String(row.parse_success_rate ?? 0),
    js_fallback_rate: String(row.js_fallback_rate ?? 0),
    source_breakdown: String(row.source_breakdown_json ?? "{}"),
    warnings: parseJsonList(String(row.warnings_json ?? "[]")).join(" | "),
    errors: parseJsonList(String(row.errors_json ?? "[]")).join(" | "),
    artifacts: parseJsonList(String(row.artifacts_json ?? "[]")).join(" | "),
  }));
}

function mergeManualColumns(localRows: Row[], existingRows: Row[]): Row[] {
  const existingByKey = new Map(existingRows.map((row) => [row.canonical_key, row]));
  return localRows.map((row) => {
    const existing = existingByKey.get(row.canonical_key);
    if (!existing) return row;
    const merged = { ...row };
    for (const column of JOB_MANUAL_COLUMNS) {
      merged[column] = existing[column] ?? row[column] ?? "";
    }
    return merged;
  });
}

function dayKey(value: string): string {
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "unknown-date";
}

function dailyJobTabs(
  db: ReturnType<typeof openDatabase>["db"],
  prefix = "Jobs ",
): Array<{ title: string; rows: Row[] }> {
  const jobs = db
    .prepare("SELECT * FROM jobs WHERE status != 'excluded' ORDER BY created_at DESC, updated_at DESC")
    .all() as JobRecord[];

  const groups = new Map<string, JobRecord[]>();
  for (const job of jobs) {
    const key = dayKey(job.posted_at || job.created_at || job.updated_at || "");
    const rows = groups.get(key) ?? [];
    rows.push(job);
    groups.set(key, rows);
  }

  return Array.from(groups.entries())
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, rows]) => ({
      title: `${prefix}${date}`.slice(0, 100),
      rows: rows.map((job) => ({
        canonical_key: job.canonical_key,
        title: job.title,
        title_family: job.title_family,
        company_name: job.company_name,
        lane: job.lane,
        score: String(job.score),
        eligibility: job.eligibility,
        category: job.category,
        recommendation: job.recommendation || "watch",
        recommended_route: job.recommended_route || "no_action",
        route_confidence: String(job.route_confidence ?? 0),
        pitch_theme: job.pitch_theme || "",
        pitch_angle: job.pitch_angle || "",
        outreach_leverage_score: String(job.outreach_leverage_score ?? 0),
        interview_probability_band: job.interview_probability_band || "low",
        opportunity_cost_band: job.opportunity_cost_band || "medium",
        startup_fit_score: String(job.startup_fit_score),
        contactability_score: String(job.contactability_score),
        location: job.location,
        work_model: job.work_model,
        posted_at: job.posted_at,
        url: job.url,
        best_contact: bestContact(job),
        explanation_short: shortExplanation(job),
        manual_status: job.manual_status || "",
        priority: job.priority || "",
        outreach_state: job.outreach_state || "",
        owner_notes: job.owner_notes || "",
        manual_contact_override: job.manual_contact_override || "",
      })),
    }));
}

export async function syncSheets(
  baseDir: string,
  gateway: SheetGateway = new GoogleSheetGateway(),
  runId?: number,
  scope: "all" | "companies_only" = "all",
) {
  const { db } = openDatabase(baseDir);
  const settings = resolveSheetSettings(baseDir);
  const spreadsheetId =
    settings.spreadsheetId ||
    getStoredSpreadsheetId(db) ||
    (settings.createIfMissing ? await gateway.createSpreadsheet("Job Sniper", settings.folderId) : "");

  if (!spreadsheetId) {
    throw new Error("No spreadsheet ID configured and sheet auto-create is disabled.");
  }

  for (const title of [settings.tabs.jobs, settings.tabs.companies, settings.tabs.contacts, settings.tabs.runMetrics]) {
    await gateway.ensureSheet(spreadsheetId, title);
  }

  let mergedJobs: Row[] = [];

  if (scope === "all") {
    const existingJobs = await gateway.readSheet(spreadsheetId, settings.tabs.jobs);
    mergedJobs = mergeManualColumns(jobRows(db), existingJobs);

    await gateway.writeSheet(spreadsheetId, settings.tabs.jobs, mergedJobs, [...JOB_HEADERS]);
    await gateway.writeSheet(spreadsheetId, settings.tabs.runMetrics, runMetricRows(db), [...RUN_METRIC_HEADERS]);

    const dailyTabs = dailyJobTabs(db, settings.tabs.dailyJobsPrefix ?? "Jobs ");
    for (const tab of dailyTabs) {
      await gateway.ensureSheet(spreadsheetId, tab.title);
      await gateway.writeSheet(spreadsheetId, tab.title, tab.rows, [...JOB_HEADERS]);
    }

    if (gateway.listSheetTitles && gateway.deleteSheet) {
      const existingTitles = await gateway.listSheetTitles(spreadsheetId);
      const liveDailyTitles = new Set(dailyTabs.map((tab) => tab.title));
      const jobsPrefix = settings.tabs.dailyJobsPrefix ?? "Jobs ";
      for (const title of existingTitles) {
        if (title === settings.tabs.jobs) continue;
        if (title.startsWith(jobsPrefix) && !liveDailyTitles.has(title)) {
          await gateway.deleteSheet(spreadsheetId, title);
        }
      }
    }
  }

  await gateway.writeSheet(spreadsheetId, settings.tabs.companies, companyRows(db), [...COMPANY_HEADERS]);
  await gateway.writeSheet(spreadsheetId, settings.tabs.contacts, contactRows(db), [...CONTACT_HEADERS]);

  saveSpreadsheetState(db, spreadsheetId, {
    lastSyncAt: new Date().toISOString(),
    meta: {
      lastRunId: runId ?? null,
      lastJobsCount: mergedJobs.length,
      lastSyncScope: scope,
    },
  });
  return {
    spreadsheetId,
    url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    jobs: mergedJobs.length,
    runId: runId ?? null,
  } satisfies SheetSyncResult;
}

export async function pullSheets(baseDir: string, gateway: SheetGateway = new GoogleSheetGateway()) {
  const { db } = openDatabase(baseDir);
  const settings = resolveSheetSettings(baseDir);
  const spreadsheetId = settings.spreadsheetId || getStoredSpreadsheetId(db);
  if (!spreadsheetId) {
    throw new Error("No spreadsheet ID configured or stored yet. Run `sheet sync` first.");
  }

  const rows = await gateway.readSheet(spreadsheetId, settings.tabs.jobs);
  let pulled = 0;
  for (const row of rows) {
    if (!row.canonical_key) {
      continue;
    }
    const updated = updateJobManualFields(db, row.canonical_key, {
      manual_status: row.manual_status,
      owner_notes: row.owner_notes,
      priority: row.priority,
      outreach_state: row.outreach_state,
      manual_contact_override: row.manual_contact_override,
    });
    if (updated) {
      pulled += 1;
    }
  }

  saveSpreadsheetState(db, spreadsheetId, { lastPullAt: new Date().toISOString() });
  return { spreadsheetId, pulled };
}
