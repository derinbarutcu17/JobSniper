import fs from "node:fs";
import { google } from "googleapis";
import { loadConfig } from "../normalization/config.js";
import { normalizeUrl } from "../lib/url.js";
import { getStoredSpreadsheetId, openDatabase, saveSpreadsheetState, updateJobManualFields } from "./db.js";
import { companyOutreachSnapshotMap } from "./outreach-state.js";
import { resolveCompanyBestContact } from "../ingestion/company-enrich.js";
import { scoreContactCandidate } from "../normalization/contact-quality.js";
import type { ContactCandidate, JobRecord, SheetSyncResult } from "../types.js";

type Row = Record<string, string>;

export interface SheetGateway {
  createSpreadsheet(title: string, folderId?: string): Promise<string>;
  ensureSheet(spreadsheetId: string, title: string): Promise<void>;
  readSheet(spreadsheetId: string, title: string): Promise<Row[]>;
  writeSheet(spreadsheetId: string, title: string, rows: Row[], headers?: string[]): Promise<void>;
  listSheetTitles?(spreadsheetId: string): Promise<string[]>;
  deleteSheet?(spreadsheetId: string, title: string): Promise<void>;
  formatDailySheet?(
    spreadsheetId: string,
    title: string,
    options: { kind: "jobs" | "companies" | "contacts"; headers: string[]; rowCount: number },
  ): Promise<void>;
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
  "pipeline_status",
  "company_outreach_status",
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
  "outreach_status",
  "last_contact_channel",
  "latest_activity_at",
  "latest_status_note",
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

const NON_COMPANY_HOSTS = new Set([
  "linkedin.com",
  "www.linkedin.com",
  "de.linkedin.com",
  "uk.linkedin.com",
  "es.linkedin.com",
  "ie.linkedin.com",
  "wellfound.com",
  "www.wellfound.com",
  "github.com",
  "www.github.com",
]);

function normalizeSheetText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function asNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeSheetHost(value: string): string {
  try {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const parsed = trimmed.includes("://") ? new URL(trimmed) : null;
    const host = (parsed?.hostname ?? trimmed).replace(/^www\./, "").toLowerCase().replace(/\/.*$/, "");
    return NON_COMPANY_HOSTS.has(host) ? "" : host;
  } catch {
    const host = value.trim().toLowerCase().replace(/^www\./, "").replace(/\/.*$/, "");
    return NON_COMPANY_HOSTS.has(host) ? "" : host;
  }
}

function companySheetDedupeKey(company: Record<string, unknown>): string {
  const host =
    normalizeSheetHost(String(company.domain ?? "")) ||
    normalizeSheetHost(String(company.company_url ?? "")) ||
    normalizeSheetHost(String(company.careers_url ?? "")) ||
    normalizeSheetHost(String(company.contact_url ?? ""));
  if (host) return `domain:${host}`;
  return `name:${normalizeSheetText(String(company.name ?? ""))}`;
}

function contactSheetValue(contact: Record<string, unknown>): string {
  const email = String(contact.email ?? "").trim();
  if (email) return email.toLowerCase();
  const linkedinUrl = String(contact.linkedin_url ?? "").trim();
  if (linkedinUrl) return normalizeUrl(linkedinUrl).toLowerCase();
  const sourceUrl = String(contact.source_url ?? "").trim();
  if (sourceUrl) return normalizeUrl(sourceUrl).toLowerCase();
  return "";
}

function contactSheetDedupeKey(companyKey: string, contact: Record<string, unknown>): string {
  return `${companyKey}::${normalizeSheetText(contactSheetValue(contact))}`;
}

function contactKindRank(kind: string): number {
  switch (kind) {
    case "founder_email":
      return 8;
    case "general_contact_email":
      return 7;
    case "recruiter_email":
      return 6;
    case "application_email":
      return 5;
    case "careers_email":
      return 4;
    case "team_page":
      return 3;
    case "contact_form":
      return 2;
    case "linkedin_person":
      return 1;
    case "linkedin_company":
      return 0;
    default:
      return 1;
  }
}

function outreachRank(status: string): number {
  switch (status) {
    case "applied":
      return 5;
    case "contacted":
      return 4;
    case "talking":
      return 3;
    case "sent_email":
    case "reached":
      return 2;
    case "new":
      return 1;
    case "rejected":
    case "archived":
      return 0;
    default:
      return 1;
  }
}

function stageRank(stage: string): number {
  switch (normalizeSheetText(stage)) {
    case "pre-seed":
      return 6;
    case "seed":
      return 5;
    case "series a":
      return 4;
    case "series b":
      return 3;
    case "growth":
      return 2;
    default:
      return 1;
  }
}

function hasMeaningfulCompanyRoute(company: Record<string, unknown>): boolean {
  return [
    String(company.company_url ?? ""),
    String(company.careers_url ?? ""),
    String(company.contact_url ?? ""),
    String(company.about_url ?? ""),
    String(company.team_url ?? ""),
    String(company.press_url ?? ""),
  ].some((value) => Boolean(normalizeSheetHost(value)));
}

function hasFundingSignal(company: Record<string, unknown>): boolean {
  const stage = normalizeSheetText(String(company.stage_text ?? ""));
  const startupScore = Number(company.startup_score ?? 0);
  const companyFitScore = Number(company.company_fit_score ?? 0);
  const hiringSignalScore = Number(company.hiring_signal_score ?? 0);
  const priorityBand = normalizeSheetText(String(company.priority_band ?? ""));
  const recommendation = normalizeSheetText(String(company.recommendation ?? ""));
  const isStartupCandidate = Boolean(Number(company.is_startup_candidate ?? 0));
  const openRoleCount = Number(company.open_role_count ?? 0);

  return Boolean(
    isStartupCandidate ||
      openRoleCount > 0 ||
      startupScore >= 60 ||
      companyFitScore >= 60 ||
      hiringSignalScore >= 40 ||
      priorityBand === "high" ||
      recommendation !== "watch" ||
      stage === "pre-seed" ||
      stage === "seed" ||
      stage === "series a" ||
      stage === "series b",
  );
}

function shouldIncludeCompanyInSheet(company: Record<string, unknown>): boolean {
  const hasDomain = Boolean(normalizeSheetHost(String(company.domain ?? "")));
  if (hasDomain) return true;
  return hasMeaningfulCompanyRoute(company) || hasFundingSignal(company);
}

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

  private async resolveSheetId(spreadsheetId: string, title: string): Promise<number> {
    const spreadsheet = await this.sheets.spreadsheets.get({ spreadsheetId });
    const sheet = (spreadsheet.data.sheets ?? []).find((entry) => entry.properties?.title === title);
    const sheetId = sheet?.properties?.sheetId;
    if (sheetId === undefined || sheetId === null) {
      throw new Error(`Sheet "${title}" was not found in spreadsheet ${spreadsheetId}.`);
    }
    return sheetId;
  }

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

  async formatDailySheet(
    spreadsheetId: string,
    title: string,
    options: { kind: "jobs" | "companies" | "contacts"; headers: string[]; rowCount: number },
  ): Promise<void> {
    const sheetId = await this.resolveSheetId(spreadsheetId, title);
    const columnCount = Math.max(options.headers.length, 1);
    const rowCount = Math.max(options.rowCount + 1, 2);
    const confidenceIndex = options.headers.indexOf("confidence_label");
    const statusIndex = options.headers.indexOf("status");
    const stageIndex = options.headers.indexOf("stage");
    const bodyFontSize = options.kind === "jobs" ? 11 : options.kind === "companies" ? 10 : 9;
    const bodyRowHeight = options.kind === "jobs" ? 28 : options.kind === "companies" ? 22 : 20;
    const bodyWrapStrategy: "CLIP" | "WRAP" = options.kind === "jobs" ? "WRAP" : "CLIP";
    const confidenceRules = confidenceIndex >= 0
      ? [
          { text: "high", color: { red: 0.85, green: 0.96, blue: 0.88 } },
          { text: "good", color: { red: 0.9, green: 0.96, blue: 1 } },
          { text: "maybe", color: { red: 1, green: 0.96, blue: 0.82 } },
          { text: "low", color: { red: 1, green: 0.89, blue: 0.89 } },
        ]
      : [];
    const statusRules = statusIndex >= 0
      ? [
          { text: "applied", color: { red: 0.87, green: 0.95, blue: 0.88 } },
          { text: "contacted", color: { red: 0.92, green: 0.96, blue: 1 } },
          { text: "found", color: { red: 1, green: 0.97, blue: 0.9 } },
        ]
      : [];
    const stageRules = options.kind === "companies" && stageIndex >= 0
      ? [
          { text: "pre-seed", color: { red: 1, green: 0.94, blue: 0.84 } },
          { text: "seed", color: { red: 0.9, green: 0.95, blue: 1 } },
          { text: "series a", color: { red: 0.88, green: 0.96, blue: 0.93 } },
          { text: "series b", color: { red: 0.92, green: 0.92, blue: 1 } },
          { text: "growth", color: { red: 0.96, green: 0.93, blue: 1 } },
        ]
      : [];

    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId,
                gridProperties: {
                  frozenRowCount: 1,
                },
              },
              fields: "gridProperties.frozenRowCount",
            },
          },
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columnCount },
              cell: {
                userEnteredFormat: {
                  backgroundColor: options.kind === "jobs"
                    ? { red: 0.13, green: 0.28, blue: 0.51 }
                    : options.kind === "companies"
                      ? { red: 0.09, green: 0.39, blue: 0.31 }
                      : { red: 0.26, green: 0.34, blue: 0.48 },
                  textFormat: {
                    foregroundColor: { red: 1, green: 1, blue: 1 },
                    bold: true,
                    fontSize: 12,
                  },
                  horizontalAlignment: "CENTER",
                  verticalAlignment: "MIDDLE",
                  wrapStrategy: "WRAP",
                },
              },
              fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)",
            },
          },
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: columnCount },
              cell: {
                userEnteredFormat: {
                  backgroundColor: { red: 0.985, green: 0.989, blue: 0.994 },
                  textFormat: { fontSize: bodyFontSize },
                  verticalAlignment: "TOP",
                  wrapStrategy: bodyWrapStrategy,
                },
              },
              fields: "userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy)",
            },
          },
          {
            updateDimensionProperties: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: 0,
                endIndex: 1,
              },
              properties: { pixelSize: 34 },
              fields: "pixelSize",
            },
          },
          {
            updateDimensionProperties: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex: 1,
                endIndex: rowCount,
              },
              properties: { pixelSize: bodyRowHeight },
              fields: "pixelSize",
            },
          },
          {
            setBasicFilter: {
              filter: {
                range: { sheetId, startRowIndex: 0, endRowIndex: rowCount, startColumnIndex: 0, endColumnIndex: columnCount },
              },
            },
          },
          {
            autoResizeDimensions: {
              dimensions: {
                sheetId,
                dimension: "COLUMNS",
                startIndex: 0,
                endIndex: columnCount,
              },
            },
          },
          ...confidenceRules.map((rule) => ({
            addConditionalFormatRule: {
              rule: {
                ranges: [{ sheetId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: confidenceIndex, endColumnIndex: confidenceIndex + 1 }],
                booleanRule: {
                  condition: {
                    type: "TEXT_EQ",
                    values: [{ userEnteredValue: rule.text }],
                  },
                  format: { backgroundColor: rule.color },
                },
              },
              index: 0,
            },
          })),
          ...statusRules.map((rule) => ({
            addConditionalFormatRule: {
              rule: {
                ranges: [{ sheetId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: statusIndex, endColumnIndex: statusIndex + 1 }],
                booleanRule: {
                  condition: {
                    type: "TEXT_EQ",
                    values: [{ userEnteredValue: rule.text }],
                  },
                  format: { backgroundColor: rule.color, textFormat: { bold: true } },
                },
              },
              index: 0,
            },
          })),
          ...stageRules.map((rule) => ({
            addConditionalFormatRule: {
              rule: {
                ranges: [{ sheetId, startRowIndex: 1, endRowIndex: rowCount, startColumnIndex: stageIndex, endColumnIndex: stageIndex + 1 }],
                booleanRule: {
                  condition: {
                    type: "TEXT_EQ",
                    values: [{ userEnteredValue: rule.text }],
                  },
                  format: { backgroundColor: rule.color },
                },
              },
              index: 0,
            },
          })),
        ],
      },
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

function jobRows(db: ReturnType<typeof openDatabase>["db"], maxRows = 200): Row[] {
  const companyOutreach = companyOutreachSnapshotMap(db);
  const jobs = db
    .prepare(`
      SELECT * FROM jobs
      WHERE status != 'excluded'
        AND last_seen_at >= datetime('now', '-90 days')
      ORDER BY score DESC, updated_at DESC
      LIMIT ?
    `)
    .all(maxRows) as JobRecord[];
  const RESOLVED = new Set(["applied", "contacted", "talking", "rejected", "archived"]);
  return jobs
    .map((job) => ({
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
      pipeline_status: job.pipeline_status || "discovered",
      company_outreach_status: companyOutreach.get(Number(job.company_id ?? 0))?.status ?? "new",
      explanation_short: shortExplanation(job),
      manual_status: job.manual_status || "",
      priority: job.priority || "",
      outreach_state: job.outreach_state || "",
      owner_notes: job.owner_notes || "",
      manual_contact_override: job.manual_contact_override || "",
    }))
    .filter((row) => !RESOLVED.has(row.company_outreach_status));
}

function dedupeCompanyContacts(
  company: Record<string, unknown>,
  contacts: Array<Record<string, unknown>>,
  limit = 2,
): Array<Record<string, unknown>> {
  const companyKey = companySheetDedupeKey(company);
  const ranked = [...contacts]
    .filter((contact) => contactSheetValue(contact))
    .sort((left, right) => {
      const scoreDelta = scoreContactForCompany(company, right) - scoreContactForCompany(company, left);
      if (scoreDelta !== 0) return scoreDelta;
      const updatedDelta = String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? ""));
      if (updatedDelta !== 0) return updatedDelta;
      return contactKindRank(String(right.contact_kind ?? "")) - contactKindRank(String(left.contact_kind ?? ""));
    });

  const deduped = new Map<string, Record<string, unknown>>();
  for (const contact of ranked) {
    const key = contactSheetDedupeKey(companyKey, contact);
    if (!deduped.has(key)) {
      deduped.set(key, contact);
    }
  }

  const uniqueContacts = [...deduped.values()];
  const hasNonLinkedIn = uniqueContacts.some((contact) => !String(contact.contact_kind ?? "").startsWith("linkedin"));
  const filtered = hasNonLinkedIn
    ? uniqueContacts.filter((contact) => !String(contact.contact_kind ?? "").startsWith("linkedin"))
    : uniqueContacts
        .filter((contact) => String(contact.contact_kind ?? "").startsWith("linkedin"))
        .slice(0, 2)
        .concat(uniqueContacts.filter((contact) => !String(contact.contact_kind ?? "").startsWith("linkedin")));

  return filtered
    .sort((left, right) => {
      const scoreDelta = scoreContactForCompany(company, right) - scoreContactForCompany(company, left);
      if (scoreDelta !== 0) return scoreDelta;
      const kindDelta = contactKindRank(String(right.contact_kind ?? "")) - contactKindRank(String(left.contact_kind ?? ""));
      if (kindDelta !== 0) return kindDelta;
      return String(right.updated_at ?? "").localeCompare(String(left.updated_at ?? ""));
    })
    .slice(0, limit);
}

function bestCompanyContact(company: Record<string, unknown>, contacts: Array<Record<string, unknown>>): string {
  const preferred = [...contacts].sort(
    (left, right) => scoreContactForCompany(company, right) - scoreContactForCompany(company, left),
  )[0];
  if (preferred) {
    return String(preferred.email ?? preferred.linkedin_url ?? preferred.source_url ?? "");
  }
  return resolveCompanyBestContact(company);
}

type CompanySheetEntry = {
  company: Record<string, unknown>;
  companyId: number;
  companyContacts: Array<Record<string, unknown>>;
  bestContact: string;
  outreachStatus: string;
  lastContactChannel: string;
  latestActivityAt: string;
  latestStatusNote: string;
  directContactCount: number;
  contactabilityScore: number;
  stageText: string;
  priorityBand: string;
  confidence: number;
};

function companySheetEntries(db: ReturnType<typeof openDatabase>["db"]): CompanySheetEntry[] {
  const outreach = companyOutreachSnapshotMap(db);
  const companies = db.prepare("SELECT * FROM companies").all() as Array<Record<string, unknown>>;
  const contacts = db
    .prepare(`
      SELECT ct.*, c.name AS company_name, c.domain AS company_domain, c.company_url AS company_url
      FROM contacts ct
      LEFT JOIN companies c ON c.id = ct.company_id
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

  const rankedCompanies = companies
    .map((company) => {
      const companyId = Number(company.id ?? 0);
      const outreachSnapshot = outreach.get(companyId);
      const companyContacts = dedupeCompanyContacts(company, contactsByCompanyId.get(companyId) ?? []);
      const directContactCount = companyContacts.filter((contact) => Boolean(String(contact.email ?? "").trim())).length;
      const bestContact = bestCompanyContact(company, companyContacts);
      return {
        company,
        companyId,
        companyContacts,
        bestContact,
        outreachStatus: outreachSnapshot?.status ?? "new",
        lastContactChannel: outreachSnapshot?.lastContactChannel ?? "",
        latestActivityAt: outreachSnapshot?.latestActivityAt ?? "",
        latestStatusNote: outreachSnapshot?.latestNote ?? "",
        directContactCount,
        contactabilityScore: Number(company.contactability_score ?? 0),
        stageText: String(company.stage_text ?? ""),
        priorityBand: String(company.priority_band ?? "low"),
        confidence: Number(company.company_fit_score ?? 0),
      };
    })
    .sort((left, right) => {
      const outreachDelta = outreachRank(right.outreachStatus) - outreachRank(left.outreachStatus);
      if (outreachDelta !== 0) return outreachDelta;
      const directDelta = right.directContactCount - left.directContactCount;
      if (directDelta !== 0) return directDelta;
      const contactabilityDelta = right.contactabilityScore - left.contactabilityScore;
      if (contactabilityDelta !== 0) return contactabilityDelta;
      const stageDelta = stageRank(right.stageText) - stageRank(left.stageText);
      if (stageDelta !== 0) return stageDelta;
      const priorityWeight = (value: string) => (value === "high" ? 3 : value === "medium" ? 2 : 1);
      const priorityDelta = priorityWeight(right.priorityBand) - priorityWeight(left.priorityBand);
      if (priorityDelta !== 0) return priorityDelta;
      const confidenceDelta = right.confidence - left.confidence;
      if (confidenceDelta !== 0) return confidenceDelta;
      return normalizeSheetText(String(left.company.name ?? "")).localeCompare(normalizeSheetText(String(right.company.name ?? "")));
    });

  const RESOLVED = new Set(["applied", "contacted", "sent_email", "talking", "rejected", "archived"]);
  const activeCompanies = rankedCompanies.filter((entry) => !RESOLVED.has(entry.outreachStatus));
  const includedCompanies = activeCompanies.filter((entry) => shouldIncludeCompanyInSheet(entry.company));

  const dedupedCompanies = new Map<string, (typeof includedCompanies)[number]>();
  for (const entry of includedCompanies) {
    const key = companySheetDedupeKey(entry.company);
    if (!dedupedCompanies.has(key)) {
      dedupedCompanies.set(key, entry);
    }
  }

  return [...dedupedCompanies.values()].sort((left, right) => {
      const stageDelta = stageRank(right.stageText) - stageRank(left.stageText);
      if (stageDelta !== 0) return stageDelta;
      const priorityWeight = (value: string) => (value === "high" ? 3 : value === "medium" ? 2 : 1);
      const priorityDelta = priorityWeight(right.priorityBand) - priorityWeight(left.priorityBand);
      if (priorityDelta !== 0) return priorityDelta;
      const contactabilityDelta = right.contactabilityScore - left.contactabilityScore;
      if (contactabilityDelta !== 0) return contactabilityDelta;
      return normalizeSheetText(String(left.company.name ?? "")).localeCompare(normalizeSheetText(String(right.company.name ?? "")));
  });
}

function companyRows(db: ReturnType<typeof openDatabase>["db"]): Row[] {
  return companySheetEntries(db).map((entry) => ({
    canonical_key: String(entry.company.canonical_key ?? ""),
    name: String(entry.company.name ?? ""),
    domain: String(entry.company.domain ?? ""),
    location: String(entry.company.location ?? ""),
    recommendation: String(entry.company.recommendation ?? "watch"),
    recommendation_reason: String(entry.company.recommendation_reason ?? ""),
    best_route: String(entry.company.best_route ?? "watch_company"),
    priority_band: String(entry.priorityBand ?? "low"),
    reachable_now: String(entry.company.reachable_now ?? 0),
    open_role_count: String(entry.company.open_role_count ?? 0),
    direct_contact_count: String(entry.directContactCount ?? 0),
    startup_score: String(entry.company.startup_score ?? 0),
    company_fit_score: String(entry.company.company_fit_score ?? 0),
    hiring_signal_score: String(entry.company.hiring_signal_score ?? 0),
    contactability_score: String(entry.company.contactability_score ?? 0),
    is_startup_candidate: String(entry.company.is_startup_candidate ?? 0),
    pitch_theme: String(entry.company.pitch_theme ?? ""),
    pitch_angle: String(entry.company.pitch_angle ?? ""),
    pitch_evidence: parseJsonList(String(entry.company.pitch_evidence ?? "[]")).join(" | "),
    startup_signals: parseJsonList(String(entry.company.startup_signals ?? "[]")).join(" | "),
    hiring_signals: parseJsonList(String(entry.company.hiring_signals ?? "[]")).join(" | "),
    founder_names: parseJsonList(String(entry.company.founder_names ?? "[]")).join(" | "),
    stage_text: String(entry.stageText ?? ""),
    size_band: String(entry.company.size_band ?? ""),
    remote_policy: String(entry.company.remote_policy ?? ""),
    company_url: String(entry.company.company_url ?? ""),
    careers_url: String(entry.company.careers_url ?? ""),
    about_url: String(entry.company.about_url ?? ""),
    team_url: String(entry.company.team_url ?? ""),
    contact_url: String(entry.company.contact_url ?? ""),
    press_url: String(entry.company.press_url ?? ""),
    linkedin_url: String(entry.company.linkedin_url ?? ""),
    best_contact: entry.bestContact,
    outreach_status: entry.outreachStatus,
    last_contact_channel: entry.lastContactChannel,
    latest_activity_at: entry.latestActivityAt,
    latest_status_note: entry.latestStatusNote,
    source_urls: parseJsonList(String(entry.company.source_urls ?? "[]")).join(" | "),
    description: String(entry.company.description ?? ""),
  }));
}

function contactRows(db: ReturnType<typeof openDatabase>["db"]): Row[] {
  const entries = companySheetEntries(db);
  const companyOrder = new Map<string, number>();
  const companyByKey = new Map<string, Record<string, unknown>>();
  const selectedContactsByCompanyKey = new Map<string, Array<Record<string, unknown>>>();

  entries.forEach((entry, index) => {
    const key = companySheetDedupeKey(entry.company);
    companyOrder.set(key, index);
    companyByKey.set(key, entry.company);
    selectedContactsByCompanyKey.set(key, entry.companyContacts);
  });

  const rows: Row[] = [];
  for (const [companyKey, contactRowsForCompany] of selectedContactsByCompanyKey.entries()) {
    for (const contact of contactRowsForCompany) {
      rows.push({
        canonical_key: String(contact.canonical_key ?? ""),
        company_name: String(contact.company_name ?? String(companyByKey.get(companyKey)?.name ?? "")),
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
        company_order: String(companyOrder.get(companyKey) ?? 0),
        contact_rank: String(contactKindRank(String(contact.contact_kind ?? ""))),
      });
    }
  }

  return rows
    .sort((left, right) => {
      const companyDelta = asNumber(left.company_order) - asNumber(right.company_order);
      if (companyDelta !== 0) return companyDelta;
      const rankDelta = asNumber(right.contact_rank) - asNumber(left.contact_rank);
      if (rankDelta !== 0) return rankDelta;
      const confidenceDelta = asNumber(right.is_public) - asNumber(left.is_public);
      if (confidenceDelta !== 0) return confidenceDelta;
      return String(right.last_verified_at ?? "").localeCompare(String(left.last_verified_at ?? ""));
    })
    .map(({ company_order: _companyOrder, contact_rank: _contactRank, ...row }) => row);
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

    const jobsPrefix = settings.tabs.dailyJobsPrefix ?? "Jobs ";
    if (gateway.listSheetTitles && gateway.deleteSheet) {
      const existingTitles = await gateway.listSheetTitles(spreadsheetId);
      for (const title of existingTitles) {
        if (title === settings.tabs.jobs) continue;
        if (title.startsWith(jobsPrefix)) {
          await gateway.deleteSheet(spreadsheetId, title);
        }
      }
    }
  }

  const companies = companyRows(db);
  const contacts = contactRows(db);
  await gateway.writeSheet(spreadsheetId, settings.tabs.companies, companies, [...COMPANY_HEADERS]);
  await gateway.writeSheet(spreadsheetId, settings.tabs.contacts, contacts, [...CONTACT_HEADERS]);
  await gateway.formatDailySheet?.(spreadsheetId, settings.tabs.companies, {
    kind: "companies",
    headers: [...COMPANY_HEADERS],
    rowCount: companies.length,
  });
  await gateway.formatDailySheet?.(spreadsheetId, settings.tabs.contacts, {
    kind: "contacts",
    headers: [...CONTACT_HEADERS],
    rowCount: contacts.length,
  });

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
