import fs from "node:fs";
import Database from "better-sqlite3";
import { resolveDataPath } from "./lib/paths.js";
import { uniqueNonEmpty } from "./lib/text.js";
import { canonicalCompanyKey, canonicalContactKey, canonicalJobKey, domainFromUrl, domainTitleFingerprint } from "./lib/url.js";
import type {
  ApplicationMethod,
  ApplicationRecord,
  PipelineStatus,
  CompanyDecisionSnapshot,
  CompanyRecordInput,
  ConfidenceBand,
  ContactCandidate,
  ContactChannel,
  ContactLogEntry,
  ContactRecordInput,
  DiscoveryCandidate,
  JobDecisionSnapshot,
  JobRecord,
  ListingCandidate,
  OutcomeLogEntry,
  OutcomeResult,
  ProfileSummary,
  RunRecord,
  RunStatus,
  RunSummary,
  ScoreBreakdown,
  SearchLane,
  SniperConfig,
} from "./types.js";

export interface DatabaseBundle {
  db: Database.Database;
  baseDir: string;
}

interface FinishRunInput {
  status: "succeeded" | "failed" | "partial";
  sourceBreakdown: Record<string, number>;
  warnings: string[];
  errors: string[];
  artifacts: string[];
  summary: RunSummary;
}

function nowIso(now = new Date()): string {
  return now.toISOString();
}

function parseStoredArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  }
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function mergeStringArrays(...values: Array<unknown>): string[] {
  return uniqueNonEmpty(values.flatMap((value) => parseStoredArray(value)));
}

function preferNonEmpty(...values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

function genericStageLabel(value: unknown): boolean {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized === "" || normalized === "startup" || normalized === "berlin startup list" || normalized === "startup list" || normalized === "watchlist";
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      executed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      domain TEXT DEFAULT '',
      location TEXT DEFAULT '',
      company_url TEXT DEFAULT '',
      careers_url TEXT DEFAULT '',
      about_url TEXT DEFAULT '',
      team_url TEXT DEFAULT '',
      contact_url TEXT DEFAULT '',
      press_url TEXT DEFAULT '',
      linkedin_url TEXT DEFAULT '',
      description TEXT DEFAULT '',
      source_urls TEXT DEFAULT '[]',
      public_contacts TEXT DEFAULT '[]',
      startup_signals TEXT DEFAULT '[]',
      hiring_signals TEXT DEFAULT '[]',
      founder_names TEXT DEFAULT '[]',
      cities TEXT DEFAULT '[]',
      size_band TEXT DEFAULT '',
      stage_text TEXT DEFAULT '',
      remote_policy TEXT DEFAULT '',
      open_role_count INTEGER DEFAULT 0,
      startup_score REAL DEFAULT 0,
      company_fit_score REAL DEFAULT 0,
      hiring_signal_score REAL DEFAULT 0,
      contactability_score REAL DEFAULT 0,
      is_startup_candidate INTEGER DEFAULT 0,
      recommendation TEXT DEFAULT 'watch',
      recommendation_reason TEXT DEFAULT '',
      best_route TEXT DEFAULT 'watch_company',
      pitch_theme TEXT DEFAULT 'generalist',
      pitch_angle TEXT DEFAULT '',
      pitch_evidence TEXT DEFAULT '[]',
      direct_contact_count INTEGER DEFAULT 0,
      reachable_now INTEGER DEFAULT 0,
      priority_band TEXT DEFAULT 'low',
      last_seen_at TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_key TEXT UNIQUE NOT NULL,
      company_id INTEGER,
      name TEXT DEFAULT '',
      title TEXT DEFAULT '',
      email TEXT DEFAULT '',
      source_url TEXT DEFAULT '',
      linkedin_url TEXT DEFAULT '',
      contact_kind TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      confidence TEXT DEFAULT 'low',
      evidence_type TEXT DEFAULT '',
      evidence_excerpt TEXT DEFAULT '',
      is_public INTEGER DEFAULT 1,
      last_verified_at TEXT DEFAULT '',
      page_type TEXT DEFAULT 'generic',
      last_seen_at TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(company_id) REFERENCES companies(id)
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_key TEXT UNIQUE NOT NULL,
      duplicate_group_key TEXT DEFAULT '',
      external_id TEXT DEFAULT '',
      company_id INTEGER,
      company_name TEXT NOT NULL,
      title TEXT NOT NULL,
      title_family TEXT DEFAULT '',
      location TEXT DEFAULT '',
      country TEXT DEFAULT '',
      language TEXT DEFAULT '',
      work_model TEXT DEFAULT 'unknown',
      employment_type TEXT DEFAULT '',
      salary TEXT DEFAULT '',
      description TEXT DEFAULT '',
      url TEXT DEFAULT '',
      apply_url TEXT DEFAULT '',
      source TEXT DEFAULT '',
      source_type TEXT DEFAULT 'page',
      lane TEXT DEFAULT 'ai_coding_jobs',
      status TEXT DEFAULT 'new',
      category TEXT DEFAULT 'Low Match',
      eligibility TEXT DEFAULT 'soft_filtered',
      score REAL DEFAULT 0,
      match_rationale TEXT DEFAULT '',
      score_explanation_json TEXT DEFAULT '{}',
      relevant_projects TEXT DEFAULT '',
      outreach_draft TEXT DEFAULT '',
      public_contacts TEXT DEFAULT '[]',
      source_urls TEXT DEFAULT '[]',
      raw_json TEXT DEFAULT '{}',
      posted_at TEXT DEFAULT '',
      valid_through TEXT DEFAULT '',
      department TEXT DEFAULT '',
      experience_years_text TEXT DEFAULT '',
      remote_scope TEXT DEFAULT '',
      parse_confidence REAL DEFAULT 0,
      source_confidence REAL DEFAULT 0,
      freshness_score REAL DEFAULT 0,
      contactability_score REAL DEFAULT 0,
      company_fit_score REAL DEFAULT 0,
      startup_fit_score REAL DEFAULT 0,
      is_real_job_page INTEGER DEFAULT 0,
      last_seen_at TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      manual_status TEXT DEFAULT '',
      owner_notes TEXT DEFAULT '',
      priority TEXT DEFAULT '',
      outreach_state TEXT DEFAULT '',
      manual_contact_override TEXT DEFAULT '',
      recommendation TEXT DEFAULT 'watch',
      recommendation_reason TEXT DEFAULT '',
      decision_explanation_json TEXT DEFAULT '{}',
      recommended_route TEXT DEFAULT 'no_action',
      route_confidence REAL DEFAULT 0,
      route_rationale TEXT DEFAULT '',
      pitch_theme TEXT DEFAULT 'generalist',
      pitch_angle TEXT DEFAULT '',
      pitch_evidence TEXT DEFAULT '[]',
      strongest_profile_signal TEXT DEFAULT '',
      strongest_company_signal TEXT DEFAULT '',
      outreach_leverage_score REAL DEFAULT 0,
      interview_probability_band TEXT DEFAULT 'low',
      opportunity_cost_band TEXT DEFAULT 'medium',
      pipeline_status TEXT DEFAULT 'discovered',
      applied_at TEXT DEFAULT '',
      application_method TEXT DEFAULT '',
      application_url TEXT DEFAULT '',
      asset_bundle_path TEXT DEFAULT '',
      cv_asset_path TEXT DEFAULT '',
      cover_letter_asset_path TEXT DEFAULT '',
      outreach_note_asset_path TEXT DEFAULT '',
      FOREIGN KEY(company_id) REFERENCES companies(id)
    );

    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      normalized_url TEXT UNIQUE NOT NULL,
      url TEXT NOT NULL,
      domain TEXT DEFAULT '',
      source_type TEXT DEFAULT '',
      intent TEXT DEFAULT '',
      page_type TEXT DEFAULT '',
      html TEXT DEFAULT '',
      text TEXT DEFAULT '',
      fetch_status INTEGER DEFAULT 0,
      used_browser_fallback INTEGER DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS crawl_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      normalized_url TEXT UNIQUE NOT NULL,
      url TEXT NOT NULL,
      lane TEXT NOT NULL,
      source_type TEXT NOT NULL,
      intent TEXT DEFAULT 'unknown',
      priority REAL DEFAULT 0,
      query TEXT DEFAULT '',
      domain TEXT DEFAULT '',
      status TEXT DEFAULT 'queued',
      attempts INTEGER DEFAULT 0,
      last_error TEXT DEFAULT '',
      discovered_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS duplicates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      duplicate_group_key TEXT UNIQUE NOT NULL,
      canonical_key TEXT DEFAULT '',
      urls_json TEXT DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS run_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER,
      started_at TEXT NOT NULL,
      finished_at TEXT DEFAULT '',
      total_discovered INTEGER DEFAULT 0,
      total_deduped INTEGER DEFAULT 0,
      total_parsed INTEGER DEFAULT 0,
      fetch_success_rate REAL DEFAULT 0,
      parse_success_rate REAL DEFAULT 0,
      js_fallback_rate REAL DEFAULT 0,
      jobs_eligible INTEGER DEFAULT 0,
      companies_discovered INTEGER DEFAULT 0,
      contacts_discovered INTEGER DEFAULT 0,
      actionable_count INTEGER DEFAULT 0,
      apply_now_count INTEGER DEFAULT 0,
      cold_email_count INTEGER DEFAULT 0,
      enrich_first_count INTEGER DEFAULT 0,
      watch_count INTEGER DEFAULT 0,
      discard_count INTEGER DEFAULT 0,
      direct_contact_companies INTEGER DEFAULT 0,
      founder_surface_companies INTEGER DEFAULT 0,
      average_outreach_leverage_score REAL DEFAULT 0,
      source_breakdown_json TEXT DEFAULT '{}',
      FOREIGN KEY(run_id) REFERENCES runs(id)
    );

    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT DEFAULT '',
      status TEXT DEFAULT 'running',
      lane TEXT DEFAULT '',
      mode TEXT DEFAULT 'full',
      source_breakdown_json TEXT DEFAULT '{}',
      warnings_json TEXT DEFAULT '[]',
      errors_json TEXT DEFAULT '[]',
      artifacts_json TEXT DEFAULT '[]',
      summary_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contact_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      job_id INTEGER,
      channel TEXT NOT NULL,
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY(company_id) REFERENCES companies(id),
      FOREIGN KEY(job_id) REFERENCES jobs(id)
    );

    CREATE TABLE IF NOT EXISTS outcome_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      job_id INTEGER,
      result TEXT NOT NULL,
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY(company_id) REFERENCES companies(id),
      FOREIGN KEY(job_id) REFERENCES jobs(id)
    );

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER UNIQUE NOT NULL,
      company_id INTEGER,
      status TEXT DEFAULT 'triaged',
      method TEXT DEFAULT 'other',
      submitted_at TEXT DEFAULT '',
      last_updated_at TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      source TEXT DEFAULT '',
      asset_bundle_path TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(job_id) REFERENCES jobs(id),
      FOREIGN KEY(company_id) REFERENCES companies(id)
    );

    CREATE TABLE IF NOT EXISTS application_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      note TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY(application_id) REFERENCES applications(id)
    );

    CREATE TABLE IF NOT EXISTS sheet_sync_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT UNIQUE NOT NULL,
      spreadsheet_id TEXT DEFAULT '',
      last_sync_at TEXT DEFAULT '',
      last_pull_at TEXT DEFAULT '',
      meta_json TEXT DEFAULT '{}'
    );
  `);
}

function patchExistingSchema(db: Database.Database): void {
  const companyColumns = [
    ["about_url", "TEXT DEFAULT ''"],
    ["team_url", "TEXT DEFAULT ''"],
    ["contact_url", "TEXT DEFAULT ''"],
    ["press_url", "TEXT DEFAULT ''"],
    ["startup_signals", "TEXT DEFAULT '[]'"],
    ["hiring_signals", "TEXT DEFAULT '[]'"],
    ["founder_names", "TEXT DEFAULT '[]'"],
    ["cities", "TEXT DEFAULT '[]'"],
    ["size_band", "TEXT DEFAULT ''"],
    ["stage_text", "TEXT DEFAULT ''"],
    ["remote_policy", "TEXT DEFAULT ''"],
    ["open_role_count", "INTEGER DEFAULT 0"],
    ["startup_score", "REAL DEFAULT 0"],
    ["company_fit_score", "REAL DEFAULT 0"],
    ["hiring_signal_score", "REAL DEFAULT 0"],
    ["contactability_score", "REAL DEFAULT 0"],
    ["is_startup_candidate", "INTEGER DEFAULT 0"],
    ["recommendation", "TEXT DEFAULT 'watch'"],
    ["recommendation_reason", "TEXT DEFAULT ''"],
    ["best_route", "TEXT DEFAULT 'watch_company'"],
    ["pitch_theme", "TEXT DEFAULT 'generalist'"],
    ["pitch_angle", "TEXT DEFAULT ''"],
    ["pitch_evidence", "TEXT DEFAULT '[]'"],
    ["direct_contact_count", "INTEGER DEFAULT 0"],
    ["reachable_now", "INTEGER DEFAULT 0"],
    ["priority_band", "TEXT DEFAULT 'low'"],
  ] as const;

  const contactColumns = [
    ["contact_kind", "TEXT DEFAULT ''"],
    ["confidence", "TEXT DEFAULT 'low'"],
    ["evidence_type", "TEXT DEFAULT ''"],
    ["evidence_excerpt", "TEXT DEFAULT ''"],
    ["is_public", "INTEGER DEFAULT 1"],
    ["last_verified_at", "TEXT DEFAULT ''"],
    ["page_type", "TEXT DEFAULT 'generic'"],
  ] as const;

  const jobColumns = [
    ["recommendation", "TEXT DEFAULT 'watch'"],
    ["recommendation_reason", "TEXT DEFAULT ''"],
    ["decision_explanation_json", "TEXT DEFAULT '{}'"],
    ["recommended_route", "TEXT DEFAULT 'no_action'"],
    ["route_confidence", "REAL DEFAULT 0"],
    ["route_rationale", "TEXT DEFAULT ''"],
    ["pitch_theme", "TEXT DEFAULT 'generalist'"],
    ["pitch_angle", "TEXT DEFAULT ''"],
    ["pitch_evidence", "TEXT DEFAULT '[]'"],
    ["strongest_profile_signal", "TEXT DEFAULT ''"],
    ["strongest_company_signal", "TEXT DEFAULT ''"],
    ["outreach_leverage_score", "REAL DEFAULT 0"],
    ["interview_probability_band", "TEXT DEFAULT 'low'"],
    ["opportunity_cost_band", "TEXT DEFAULT 'medium'"],
    ["pipeline_status", "TEXT DEFAULT 'discovered'"],
    ["applied_at", "TEXT DEFAULT ''"],
    ["application_method", "TEXT DEFAULT ''"],
    ["application_url", "TEXT DEFAULT ''"],
    ["asset_bundle_path", "TEXT DEFAULT ''"],
    ["cv_asset_path", "TEXT DEFAULT ''"],
    ["cover_letter_asset_path", "TEXT DEFAULT ''"],
    ["outreach_note_asset_path", "TEXT DEFAULT ''"],
  ] as const;

  const runMetricColumns = [
    ["run_id", "INTEGER"],
    ["actionable_count", "INTEGER DEFAULT 0"],
    ["apply_now_count", "INTEGER DEFAULT 0"],
    ["cold_email_count", "INTEGER DEFAULT 0"],
    ["enrich_first_count", "INTEGER DEFAULT 0"],
    ["watch_count", "INTEGER DEFAULT 0"],
    ["discard_count", "INTEGER DEFAULT 0"],
    ["direct_contact_companies", "INTEGER DEFAULT 0"],
    ["founder_surface_companies", "INTEGER DEFAULT 0"],
    ["average_outreach_leverage_score", "REAL DEFAULT 0"],
  ] as const;

  for (const [name, type] of companyColumns) {
    if (!hasColumn(db, "companies", name)) {
      db.exec(`ALTER TABLE companies ADD COLUMN ${name} ${type}`);
    }
  }

  for (const [name, type] of contactColumns) {
    if (!hasColumn(db, "contacts", name)) {
      db.exec(`ALTER TABLE contacts ADD COLUMN ${name} ${type}`);
    }
  }

  for (const [name, type] of jobColumns) {
    if (!hasColumn(db, "jobs", name)) {
      db.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${type}`);
    }
  }

  for (const [name, type] of runMetricColumns) {
    if (!hasColumn(db, "run_metrics", name)) {
      db.exec(`ALTER TABLE run_metrics ADD COLUMN ${name} ${type}`);
    }
  }

  createSchema(db);
}

function migrateLegacyJobs(db: Database.Database): void {
  const legacyExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'jobs'")
    .get() as { name?: string } | undefined;

  if (!legacyExists) {
    createSchema(db);
    return;
  }

  if (hasColumn(db, "jobs", "duplicate_group_key")) {
    createSchema(db);
    patchExistingSchema(db);
    return;
  }

  db.exec("ALTER TABLE jobs RENAME TO legacy_jobs");
  createSchema(db);

  const rows = db.prepare("SELECT * FROM legacy_jobs").all() as Array<Record<string, unknown>>;
  for (const row of rows) {
    const company = String(row.company_name ?? row.company ?? "Unknown");
    const title = String(row.title ?? "Untitled role");
    const url = String(row.url ?? "");
    const domain = domainFromUrl(url);
    upsertCompany(db, {
      canonicalKey: canonicalCompanyKey(company, domain),
      name: company,
      domain,
      location: String(row.location ?? ""),
      companyUrl: domain ? `https://${domain}` : "",
      careersUrl: url,
      aboutUrl: "",
      teamUrl: "",
      contactUrl: "",
      pressUrl: "",
      linkedinUrl: "",
      description: String(row.description ?? ""),
      sourceUrls: uniqueNonEmpty([url]),
      publicContacts: [],
      startupSignals: [],
      hiringSignals: [],
      founderNames: [],
      cities: uniqueNonEmpty([String(row.location ?? "")]),
      sizeBand: "",
      stageText: "",
      remotePolicy: "",
      openRoleCount: 1,
      startupScore: 0,
      companyFitScore: 0,
      hiringSignalScore: 0,
      contactabilityScore: 0,
      isStartupCandidate: false,
      lastSeenAt: String(row.created_at ?? nowIso()),
    });
    const duplicateGroupKey = domainTitleFingerprint(domainFromUrl(url), title);
    db.prepare(`
      INSERT OR IGNORE INTO jobs (
        canonical_key, duplicate_group_key, external_id, company_name, title, title_family, location, country,
        language, work_model, employment_type, salary, description, url, apply_url, source, source_type, lane,
        status, category, eligibility, score, match_rationale, score_explanation_json, relevant_projects, outreach_draft,
        public_contacts, source_urls, raw_json, posted_at, valid_through, department, experience_years_text,
        remote_scope, parse_confidence, source_confidence, freshness_score, contactability_score, company_fit_score,
        startup_fit_score, is_real_job_page, last_seen_at, created_at, updated_at, manual_status, owner_notes,
        priority, outreach_state, manual_contact_override
      ) VALUES (
        @canonical_key, @duplicate_group_key, @external_id, @company_name, @title, @title_family, @location, @country,
        @language, @work_model, @employment_type, @salary, @description, @url, @apply_url, @source, @source_type, @lane,
        @status, @category, @eligibility, @score, @match_rationale, @score_explanation_json, @relevant_projects, @outreach_draft,
        @public_contacts, @source_urls, @raw_json, @posted_at, @valid_through, @department, @experience_years_text,
        @remote_scope, @parse_confidence, @source_confidence, @freshness_score, @contactability_score, @company_fit_score,
        @startup_fit_score, @is_real_job_page, @last_seen_at, @created_at, @updated_at, @manual_status, @owner_notes,
        @priority, @outreach_state, @manual_contact_override
      )
    `).run({
      canonical_key: canonicalJobKey(url, String(row.external_id ?? ""), title, company),
      duplicate_group_key: duplicateGroupKey,
      external_id: String(row.external_id ?? ""),
      company_name: company,
      title,
      title_family: "",
      location: String(row.location ?? ""),
      country: "",
      language: String(row.language ?? ""),
      work_model: String(row.work_model ?? "unknown"),
      employment_type: String(row.employment_type ?? ""),
      salary: String(row.salary ?? ""),
      description: String(row.description ?? ""),
      url,
      apply_url: String(row.apply_url ?? url),
      source: String(row.source ?? "legacy"),
      source_type: String(row.source_type ?? "rss"),
      lane: String(row.lane ?? "ai_coding_jobs"),
      status: String(row.status ?? "new"),
      category: String(row.category ?? "Low Match"),
      eligibility: String(row.eligibility ?? "soft_filtered"),
      score: Number(row.score ?? row.match_score ?? 0),
      match_rationale: String(row.match_rationale ?? ""),
      score_explanation_json: String(row.score_explanation_json ?? "{}"),
      relevant_projects: String(row.relevant_projects ?? ""),
      outreach_draft: String(row.outreach_draft ?? ""),
      public_contacts: String(row.public_contacts ?? "[]"),
      source_urls: String(row.source_urls ?? "[]"),
      raw_json: JSON.stringify(row),
      posted_at: String(row.posted_at ?? ""),
      valid_through: String(row.valid_through ?? ""),
      department: String(row.department ?? ""),
      experience_years_text: String(row.experience_years_text ?? ""),
      remote_scope: String(row.remote_scope ?? ""),
      parse_confidence: Number(row.parse_confidence ?? 0),
      source_confidence: Number(row.source_confidence ?? 0),
      freshness_score: Number(row.freshness_score ?? 0),
      contactability_score: Number(row.contactability_score ?? 0),
      company_fit_score: Number(row.company_fit_score ?? 0),
      startup_fit_score: Number(row.startup_fit_score ?? 0),
      is_real_job_page: Number(row.is_real_job_page ?? 0),
      last_seen_at: String(row.last_seen_at ?? row.created_at ?? nowIso()),
      created_at: String(row.created_at ?? nowIso()),
      updated_at: String(row.updated_at ?? row.created_at ?? nowIso()),
      manual_status: String(row.manual_status ?? ""),
      owner_notes: String(row.owner_notes ?? ""),
      priority: String(row.priority ?? ""),
      outreach_state: String(row.outreach_state ?? ""),
      manual_contact_override: String(row.manual_contact_override ?? ""),
    });
  }
}

export function openDatabase(baseDir: string): DatabaseBundle {
  const dataDir = resolveDataPath(baseDir);
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(resolveDataPath(baseDir, "sniper.db"));
  migrateLegacyJobs(db);
  createSchema(db);
  return { db, baseDir };
}

export function upsertPageCache(
  db: Database.Database,
  input: { normalizedUrl: string; url: string; domain: string; sourceType: string; intent: string; pageType: string; html: string; text: string; fetchStatus: number; usedBrowserFallback: boolean },
): void {
  db.prepare(`
    INSERT INTO pages (
      normalized_url, url, domain, source_type, intent, page_type, html, text,
      fetch_status, used_browser_fallback, updated_at
    ) VALUES (
      @normalized_url, @url, @domain, @source_type, @intent, @page_type, @html, @text,
      @fetch_status, @used_browser_fallback, @updated_at
    )
    ON CONFLICT(normalized_url) DO UPDATE SET
      url = excluded.url,
      domain = excluded.domain,
      source_type = excluded.source_type,
      intent = excluded.intent,
      page_type = excluded.page_type,
      html = excluded.html,
      text = excluded.text,
      fetch_status = excluded.fetch_status,
      used_browser_fallback = excluded.used_browser_fallback,
      updated_at = excluded.updated_at
  `).run({
    normalized_url: input.normalizedUrl,
    url: input.url,
    domain: input.domain,
    source_type: input.sourceType,
    intent: input.intent,
    page_type: input.pageType,
    html: input.html,
    text: input.text,
    fetch_status: input.fetchStatus,
    used_browser_fallback: input.usedBrowserFallback ? 1 : 0,
    updated_at: nowIso(),
  });
}

export function enqueueDiscoveryCandidates(db: Database.Database, candidates: DiscoveryCandidate[]): { queued: number; deduped: number } {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO crawl_queue (
      normalized_url, url, lane, source_type, intent, priority, query, domain, status, attempts, last_error, discovered_at, updated_at
    ) VALUES (
      @normalized_url, @url, @lane, @source_type, @intent, @priority, @query, @domain, 'queued', 0, '', @discovered_at, @updated_at
    )
  `);
  let queued = 0;
  for (const candidate of candidates) {
    const result = insert.run({
      normalized_url: candidate.normalizedUrl,
      url: candidate.url,
      lane: candidate.lane,
      source_type: candidate.sourceType,
      intent: candidate.intent,
      priority: candidate.confidence,
      query: candidate.query ?? "",
      domain: candidate.domain,
      discovered_at: candidate.discoveredAt,
      updated_at: candidate.discoveredAt,
    });
    queued += result.changes;
  }
  return { queued, deduped: candidates.length - queued };
}

export function selectQueuedCandidates(db: Database.Database): DiscoveryCandidate[] {
  const rows = db
    .prepare(
      `SELECT url, normalized_url, source_type, lane, intent, query, priority, domain, discovered_at
       FROM crawl_queue
       WHERE status = 'queued'
       ORDER BY priority DESC, discovered_at ASC`,
    )
    .all() as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    url: String(row.url),
    normalizedUrl: String(row.normalized_url),
    sourceType: String(row.source_type) as DiscoveryCandidate["sourceType"],
    lane: String(row.lane) as SearchLane,
    intent: String(row.intent) as DiscoveryCandidate["intent"],
    query: String(row.query || ""),
    confidence: Number(row.priority ?? 0),
    source: String(row.source_type ?? "search"),
    discoveredAt: String(row.discovered_at ?? nowIso()),
    domain: String(row.domain ?? ""),
    title: "",
    snippet: "",
  }));
}

export function markCandidateStatus(db: Database.Database, normalizedUrl: string, status: "done" | "error", lastError = ""): void {
  db.prepare("UPDATE crawl_queue SET status = ?, attempts = attempts + 1, last_error = ?, updated_at = ? WHERE normalized_url = ?").run(
    status,
    lastError,
    nowIso(),
    normalizedUrl,
  );
}

export function upsertCompany(db: Database.Database, input: CompanyRecordInput): number {
  const timestamp = input.lastSeenAt || nowIso();
  const existing = db.prepare("SELECT * FROM companies WHERE canonical_key = ?").get(input.canonicalKey) as Record<string, unknown> | undefined;
  const mergedSourceUrls = mergeStringArrays(existing?.source_urls, input.sourceUrls);
  const mergedPublicContacts = mergeStringArrays(existing?.public_contacts, input.publicContacts);
  const mergedStartupSignals = mergeStringArrays(existing?.startup_signals, input.startupSignals);
  const mergedHiringSignals = mergeStringArrays(existing?.hiring_signals, input.hiringSignals);
  const mergedFounderNames = mergeStringArrays(existing?.founder_names, input.founderNames);
  const mergedCities = mergeStringArrays(existing?.cities, input.cities);
  const mergedPitchEvidence = mergeStringArrays(existing?.pitch_evidence, input.pitchEvidence ?? []);
  const directContactCount = Math.max(
    Number(existing?.direct_contact_count ?? 0),
    input.directContactCount ?? uniqueNonEmpty(input.publicContacts).length,
  );
  const reachableNow = Boolean(Number(existing?.reachable_now ?? 0) || input.reachableNow || directContactCount > 0);
  const mergedStageText =
    input.stageText && !genericStageLabel(input.stageText)
      ? input.stageText
      : !genericStageLabel(existing?.stage_text)
        ? String(existing?.stage_text ?? "")
        : "";
  const mergedStartupScore =
    mergedStageText && input.startupScore > 0
      ? input.startupScore
      : genericStageLabel(existing?.stage_text) && !input.isStartupCandidate && input.startupScore > 0
        ? input.startupScore
      : Math.max(Number(existing?.startup_score ?? 0), input.startupScore);
  const mergedStartupCandidate =
    input.isStartupCandidate || (Boolean(Number(existing?.is_startup_candidate ?? 0)) && !genericStageLabel(existing?.stage_text));

  db.prepare(`
    INSERT INTO companies (
      canonical_key, name, domain, location, company_url, careers_url, about_url, team_url,
      contact_url, press_url, linkedin_url, description, source_urls, public_contacts,
      startup_signals, hiring_signals, founder_names, cities, size_band, stage_text,
      remote_policy, open_role_count, startup_score, company_fit_score, hiring_signal_score,
      contactability_score, is_startup_candidate, recommendation, recommendation_reason, best_route,
      pitch_theme, pitch_angle, pitch_evidence, direct_contact_count, reachable_now, priority_band,
      last_seen_at, created_at, updated_at
    ) VALUES (
      @canonical_key, @name, @domain, @location, @company_url, @careers_url, @about_url, @team_url,
      @contact_url, @press_url, @linkedin_url, @description, @source_urls, @public_contacts,
      @startup_signals, @hiring_signals, @founder_names, @cities, @size_band, @stage_text,
      @remote_policy, @open_role_count, @startup_score, @company_fit_score, @hiring_signal_score, @contactability_score,
      @is_startup_candidate, @recommendation, @recommendation_reason, @best_route, @pitch_theme, @pitch_angle,
      @pitch_evidence, @direct_contact_count, @reachable_now, @priority_band, @last_seen_at, @created_at, @updated_at
    )
    ON CONFLICT(canonical_key) DO UPDATE SET
      name = excluded.name,
      domain = excluded.domain,
      location = CASE WHEN excluded.location != '' THEN excluded.location ELSE companies.location END,
      company_url = CASE WHEN excluded.company_url != '' THEN excluded.company_url ELSE companies.company_url END,
      careers_url = CASE WHEN excluded.careers_url != '' THEN excluded.careers_url ELSE companies.careers_url END,
      about_url = CASE WHEN excluded.about_url != '' THEN excluded.about_url ELSE companies.about_url END,
      team_url = CASE WHEN excluded.team_url != '' THEN excluded.team_url ELSE companies.team_url END,
      contact_url = CASE WHEN excluded.contact_url != '' THEN excluded.contact_url ELSE companies.contact_url END,
      press_url = CASE WHEN excluded.press_url != '' THEN excluded.press_url ELSE companies.press_url END,
      linkedin_url = CASE WHEN excluded.linkedin_url != '' THEN excluded.linkedin_url ELSE companies.linkedin_url END,
      description = CASE WHEN excluded.description != '' THEN excluded.description ELSE companies.description END,
      source_urls = excluded.source_urls,
      public_contacts = excluded.public_contacts,
      startup_signals = excluded.startup_signals,
      hiring_signals = excluded.hiring_signals,
      founder_names = excluded.founder_names,
      cities = excluded.cities,
      size_band = excluded.size_band,
      stage_text = excluded.stage_text,
      remote_policy = excluded.remote_policy,
      open_role_count = MAX(companies.open_role_count, excluded.open_role_count),
      startup_score = excluded.startup_score,
      company_fit_score = excluded.company_fit_score,
      hiring_signal_score = excluded.hiring_signal_score,
      contactability_score = excluded.contactability_score,
      is_startup_candidate = excluded.is_startup_candidate,
      recommendation = excluded.recommendation,
      recommendation_reason = excluded.recommendation_reason,
      best_route = excluded.best_route,
      pitch_theme = excluded.pitch_theme,
      pitch_angle = excluded.pitch_angle,
      pitch_evidence = excluded.pitch_evidence,
      direct_contact_count = excluded.direct_contact_count,
      reachable_now = excluded.reachable_now,
      priority_band = excluded.priority_band,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at
  `).run({
    canonical_key: input.canonicalKey,
    name: preferNonEmpty(input.name, existing?.name),
    domain: preferNonEmpty(existing?.domain, input.domain),
    location: preferNonEmpty(input.location, existing?.location),
    company_url: preferNonEmpty(input.companyUrl, existing?.company_url),
    careers_url: preferNonEmpty(input.careersUrl, existing?.careers_url),
    about_url: preferNonEmpty(input.aboutUrl, existing?.about_url),
    team_url: preferNonEmpty(input.teamUrl, existing?.team_url),
    contact_url: preferNonEmpty(input.contactUrl, existing?.contact_url),
    press_url: preferNonEmpty(input.pressUrl, existing?.press_url),
    linkedin_url: preferNonEmpty(input.linkedinUrl, existing?.linkedin_url),
    description: preferNonEmpty(input.description, existing?.description),
    source_urls: JSON.stringify(mergedSourceUrls),
    public_contacts: JSON.stringify(mergedPublicContacts),
    startup_signals: JSON.stringify(mergedStartupSignals),
    hiring_signals: JSON.stringify(mergedHiringSignals),
    founder_names: JSON.stringify(mergedFounderNames),
    cities: JSON.stringify(mergedCities),
    size_band: preferNonEmpty(input.sizeBand, existing?.size_band),
    stage_text: mergedStageText,
    remote_policy: preferNonEmpty(input.remotePolicy, existing?.remote_policy),
    open_role_count: Math.max(Number(existing?.open_role_count ?? 0), input.openRoleCount),
    startup_score: mergedStartupScore,
    company_fit_score: Math.max(Number(existing?.company_fit_score ?? 0), input.companyFitScore),
    hiring_signal_score: Math.max(Number(existing?.hiring_signal_score ?? 0), input.hiringSignalScore),
    contactability_score: Math.max(Number(existing?.contactability_score ?? 0), input.contactabilityScore),
    is_startup_candidate: mergedStartupCandidate ? 1 : 0,
    recommendation: input.recommendation ?? preferNonEmpty(existing?.recommendation, "watch"),
    recommendation_reason: preferNonEmpty(input.recommendationReason ?? "", existing?.recommendation_reason),
    best_route: input.bestRoute ?? preferNonEmpty(existing?.best_route, "watch_company"),
    pitch_theme: input.pitchTheme ?? preferNonEmpty(existing?.pitch_theme, "generalist"),
    pitch_angle: preferNonEmpty(input.pitchAngle ?? "", existing?.pitch_angle),
    pitch_evidence: JSON.stringify(mergedPitchEvidence),
    direct_contact_count: directContactCount,
    reachable_now: reachableNow ? 1 : 0,
    priority_band: preferNonEmpty(input.priorityBand ?? "", existing?.priority_band, "low"),
    last_seen_at: timestamp,
    created_at: preferNonEmpty(existing?.created_at, timestamp),
    updated_at: timestamp,
  });
  return (db.prepare("SELECT id FROM companies WHERE canonical_key = ?").get(input.canonicalKey) as { id: number }).id;
}

export function upsertContact(db: Database.Database, input: ContactRecordInput): number {
  const companyId = db.prepare("SELECT id FROM companies WHERE canonical_key = ?").get(input.companyCanonicalKey) as { id: number } | undefined;
  const timestamp = input.lastSeenAt || nowIso();
  db.prepare(`
    INSERT INTO contacts (
      canonical_key, company_id, name, title, email, source_url, linkedin_url, contact_kind, notes,
      confidence, evidence_type, evidence_excerpt, is_public, last_verified_at, page_type,
      last_seen_at, created_at, updated_at
    ) VALUES (
      @canonical_key, @company_id, @name, @title, @email, @source_url, @linkedin_url, @contact_kind, @notes,
      @confidence, @evidence_type, @evidence_excerpt, @is_public, @last_verified_at, @page_type,
      @last_seen_at, @created_at, @updated_at
    )
    ON CONFLICT(canonical_key) DO UPDATE SET
      company_id = excluded.company_id,
      name = excluded.name,
      title = excluded.title,
      email = CASE WHEN excluded.email != '' THEN excluded.email ELSE contacts.email END,
      source_url = CASE WHEN excluded.source_url != '' THEN excluded.source_url ELSE contacts.source_url END,
      linkedin_url = CASE WHEN excluded.linkedin_url != '' THEN excluded.linkedin_url ELSE contacts.linkedin_url END,
      contact_kind = excluded.contact_kind,
      notes = excluded.notes,
      confidence = excluded.confidence,
      evidence_type = excluded.evidence_type,
      evidence_excerpt = excluded.evidence_excerpt,
      is_public = excluded.is_public,
      last_verified_at = excluded.last_verified_at,
      page_type = excluded.page_type,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at
  `).run({
    canonical_key: input.canonicalKey,
    company_id: companyId?.id ?? null,
    name: input.name,
    title: input.title,
    email: input.email,
    source_url: input.sourceUrl,
    linkedin_url: input.linkedinUrl,
    contact_kind: input.contactKind,
    notes: input.notes,
    confidence: input.confidence,
    evidence_type: input.evidenceType,
    evidence_excerpt: input.evidenceExcerpt,
    is_public: input.isPublic ? 1 : 0,
    last_verified_at: input.lastVerifiedAt,
    page_type: input.pageType,
    last_seen_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
  });
  return (db.prepare("SELECT id FROM contacts WHERE canonical_key = ?").get(input.canonicalKey) as { id: number }).id;
}

function contactabilityFromContacts(contacts: ContactCandidate[]): number {
  if (contacts.some((contact) => contact.confidence === "high")) return 18;
  if (contacts.some((contact) => contact.confidence === "medium")) return 10;
  if (contacts.length) return 4;
  return 0;
}

function confidenceToNumber(band: ConfidenceBand): number {
  switch (band) {
    case "high":
      return 0.95;
    case "medium":
      return 0.7;
    case "low":
      return 0.45;
    case "very_low":
      return 0.2;
  }
}

export function upsertJob(
  db: Database.Database,
  config: SniperConfig,
  listing: ListingCandidate,
  score: number,
  category: JobRecord["category"],
  rationale: string,
  relevantProjects: string[],
  profile: ProfileSummary,
  breakdown: ScoreBreakdown,
  eligibility: string,
  decision?: JobDecisionSnapshot,
): { inserted: boolean; updated: boolean; excluded: boolean; companyTouched: boolean; contactsTouched: number } {
  const domain = domainFromUrl(listing.companyUrl || listing.url);
  const companyKey = canonicalCompanyKey(listing.company, domain);
  const duplicateGroupKey = domainTitleFingerprint(domain, listing.title);
  const companyId = upsertCompany(db, {
    canonicalKey: companyKey,
    name: listing.company,
    domain,
    location: listing.location,
    companyUrl: listing.companyUrl || (domain ? `https://${domain}` : ""),
    careersUrl: listing.careersUrl || listing.url,
    aboutUrl: listing.aboutUrl,
    teamUrl: listing.teamUrl,
    contactUrl: listing.contactUrl,
    pressUrl: listing.pressUrl,
    linkedinUrl: listing.companyLinkedinUrl,
    description: listing.description.slice(0, 5000),
    sourceUrls: listing.sourceUrls,
    publicContacts: listing.publicContacts.map((contact) => contact.email || contact.linkedinUrl || contact.sourceUrl),
    startupSignals: breakdown.positives.filter((entry) => /startup|founding|seed|series a/i.test(entry)),
    hiringSignals: breakdown.positives.filter((entry) => /contact|hiring|team/i.test(entry)),
    founderNames: [],
    cities: uniqueNonEmpty([listing.location]),
    sizeBand: "",
    stageText: "",
    remotePolicy: listing.remoteScope,
    openRoleCount: 1,
    startupScore: breakdown.startupFit,
    companyFitScore: breakdown.companyFit,
    hiringSignalScore: breakdown.freshnessFit,
    contactabilityScore: contactabilityFromContacts(listing.publicContacts),
    isStartupCandidate: breakdown.startupFit > 0,
    recommendation: decision?.recommendation === "apply_now" ? "enrich_first" : decision?.recommendation,
    recommendationReason: decision?.recommendationReason,
    bestRoute:
      decision?.recommendedRoute === "ats_only"
        ? "ats_plus_cold_email"
        : decision?.recommendedRoute === "no_action"
          ? "watch_company"
          : decision?.recommendedRoute,
    pitchTheme: decision?.pitchTheme,
    pitchAngle: decision?.pitchAngle,
    pitchEvidence: decision?.pitchEvidence,
    directContactCount: listing.publicContacts.filter((contact) => Boolean(contact.email || contact.linkedinUrl)).length,
    reachableNow: Boolean(listing.publicContacts.length || listing.teamUrl || listing.contactUrl),
    priorityBand:
      decision?.recommendation === "apply_now" || decision?.recommendation === "cold_email"
        ? "high"
        : decision?.recommendation === "enrich_first"
          ? "medium"
          : "low",
    lastSeenAt: nowIso(),
  });

  let contactsTouched = 0;
  for (const contact of listing.publicContacts) {
    upsertContact(db, {
      canonicalKey: canonicalContactKey(contact.email, contact.linkedinUrl, contact.name || contact.sourceUrl, companyKey),
      companyCanonicalKey: companyKey,
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
      lastVerifiedAt: nowIso(),
      pageType: contact.pageType,
      lastSeenAt: nowIso(),
    });
    contactsTouched += 1;
  }

  const canonicalKey = canonicalJobKey(listing.url, listing.externalId ?? "", listing.title, listing.company);
  const existing = db.prepare("SELECT id FROM jobs WHERE canonical_key = ?").get(canonicalKey) as { id: number } | undefined;
  const timestamp = nowIso();
  const inserted = !existing;
  const excluded = category === "Excluded" || eligibility === "excluded";

  db.prepare(`
    INSERT INTO jobs (
      canonical_key, duplicate_group_key, external_id, company_id, company_name, title, title_family, location,
      country, language, work_model, employment_type, salary, description, url, apply_url, source, source_type,
      lane, status, category, eligibility, score, match_rationale, score_explanation_json, relevant_projects,
      outreach_draft, public_contacts, source_urls, raw_json, posted_at, valid_through, department, experience_years_text,
      remote_scope, parse_confidence, source_confidence, freshness_score, contactability_score, company_fit_score,
      startup_fit_score, is_real_job_page, last_seen_at, created_at, updated_at, manual_status, owner_notes, priority,
      outreach_state, manual_contact_override, recommendation, recommendation_reason, decision_explanation_json,
      recommended_route, route_confidence, route_rationale, pitch_theme, pitch_angle, pitch_evidence,
      strongest_profile_signal, strongest_company_signal, outreach_leverage_score, interview_probability_band,
      opportunity_cost_band
    ) VALUES (
      @canonical_key, @duplicate_group_key, @external_id, @company_id, @company_name, @title, @title_family, @location,
      @country, @language, @work_model, @employment_type, @salary, @description, @url, @apply_url, @source, @source_type,
      @lane, @status, @category, @eligibility, @score, @match_rationale, @score_explanation_json, @relevant_projects,
      @outreach_draft, @public_contacts, @source_urls, @raw_json, @posted_at, @valid_through, @department, @experience_years_text,
      @remote_scope, @parse_confidence, @source_confidence, @freshness_score, @contactability_score, @company_fit_score,
      @startup_fit_score, @is_real_job_page, @last_seen_at, @created_at, @updated_at, @manual_status, @owner_notes, @priority,
      @outreach_state, @manual_contact_override, @recommendation, @recommendation_reason, @decision_explanation_json,
      @recommended_route, @route_confidence, @route_rationale, @pitch_theme, @pitch_angle, @pitch_evidence,
      @strongest_profile_signal, @strongest_company_signal, @outreach_leverage_score, @interview_probability_band,
      @opportunity_cost_band
    )
    ON CONFLICT(canonical_key) DO UPDATE SET
      duplicate_group_key = excluded.duplicate_group_key,
      external_id = excluded.external_id,
      company_id = excluded.company_id,
      company_name = excluded.company_name,
      title = excluded.title,
      title_family = excluded.title_family,
      location = excluded.location,
      country = excluded.country,
      language = excluded.language,
      work_model = excluded.work_model,
      employment_type = excluded.employment_type,
      salary = excluded.salary,
      description = excluded.description,
      url = excluded.url,
      apply_url = excluded.apply_url,
      source = excluded.source,
      source_type = excluded.source_type,
      lane = excluded.lane,
      status = excluded.status,
      category = excluded.category,
      eligibility = excluded.eligibility,
      score = excluded.score,
      match_rationale = excluded.match_rationale,
      score_explanation_json = excluded.score_explanation_json,
      relevant_projects = excluded.relevant_projects,
      public_contacts = excluded.public_contacts,
      source_urls = excluded.source_urls,
      raw_json = excluded.raw_json,
      posted_at = excluded.posted_at,
      valid_through = excluded.valid_through,
      department = excluded.department,
      experience_years_text = excluded.experience_years_text,
      remote_scope = excluded.remote_scope,
      parse_confidence = excluded.parse_confidence,
      source_confidence = excluded.source_confidence,
      freshness_score = excluded.freshness_score,
      contactability_score = excluded.contactability_score,
      company_fit_score = excluded.company_fit_score,
      startup_fit_score = excluded.startup_fit_score,
      is_real_job_page = excluded.is_real_job_page,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at
      ,
      recommendation = excluded.recommendation,
      recommendation_reason = excluded.recommendation_reason,
      decision_explanation_json = excluded.decision_explanation_json,
      recommended_route = excluded.recommended_route,
      route_confidence = excluded.route_confidence,
      route_rationale = excluded.route_rationale,
      pitch_theme = excluded.pitch_theme,
      pitch_angle = excluded.pitch_angle,
      pitch_evidence = excluded.pitch_evidence,
      strongest_profile_signal = excluded.strongest_profile_signal,
      strongest_company_signal = excluded.strongest_company_signal,
      outreach_leverage_score = excluded.outreach_leverage_score,
      interview_probability_band = excluded.interview_probability_band,
      opportunity_cost_band = excluded.opportunity_cost_band
  `).run({
    canonical_key: canonicalKey,
    duplicate_group_key: duplicateGroupKey,
    external_id: listing.externalId ?? "",
    company_id: companyId,
    company_name: listing.company,
    title: listing.title,
    title_family: listing.titleFamily,
    location: listing.location,
    country: listing.country,
    language: listing.language,
    work_model: listing.workModel,
    employment_type: listing.employmentType,
    salary: listing.salary,
    description: listing.description,
    url: listing.url,
    apply_url: listing.applyUrl || listing.url,
    source: listing.source,
    source_type: listing.sourceType,
    lane: listing.lane,
    status: excluded ? "excluded" : "analyzed",
    category,
    eligibility,
    score,
    match_rationale: rationale,
    score_explanation_json: JSON.stringify(breakdown),
    relevant_projects: relevantProjects.join(", ") || profile.toolSignals.slice(0, 3).join(", "),
    outreach_draft: "",
    public_contacts: JSON.stringify(listing.publicContacts),
    source_urls: JSON.stringify(uniqueNonEmpty(listing.sourceUrls)),
    raw_json: JSON.stringify(listing.raw ?? {}),
    posted_at: listing.postedAt,
    valid_through: listing.validThrough,
    department: listing.department,
    experience_years_text: listing.experienceYearsText,
    remote_scope: listing.remoteScope,
    parse_confidence: listing.parseConfidence,
    source_confidence: listing.sourceConfidence,
    freshness_score: listing.postedAt ? 10 : 4,
    contactability_score: contactabilityFromContacts(listing.publicContacts),
    company_fit_score: breakdown.companyFit,
    startup_fit_score: breakdown.startupFit,
    is_real_job_page: listing.isRealJobPage ? 1 : 0,
    last_seen_at: timestamp,
    created_at: timestamp,
    updated_at: timestamp,
    manual_status: "",
    owner_notes: "",
    priority: "",
    outreach_state: "",
    manual_contact_override: "",
    recommendation: decision?.recommendation ?? (excluded ? "discard" : "watch"),
    recommendation_reason: decision?.recommendationReason ?? "",
    decision_explanation_json: JSON.stringify(decision?.explanation ?? {}),
    recommended_route: decision?.recommendedRoute ?? "no_action",
    route_confidence: decision?.routeConfidence ?? 0,
    route_rationale: decision?.routeRationale ?? "",
    pitch_theme: decision?.pitchTheme ?? "generalist",
    pitch_angle: decision?.pitchAngle ?? "",
    pitch_evidence: JSON.stringify(uniqueNonEmpty(decision?.pitchEvidence ?? [])),
    strongest_profile_signal: decision?.strongestProfileSignal ?? "",
    strongest_company_signal: decision?.strongestCompanySignal ?? "",
    outreach_leverage_score: decision?.outreachLeverageScore ?? 0,
    interview_probability_band: decision?.interviewProbabilityBand ?? "low",
    opportunity_cost_band: decision?.opportunityCostBand ?? "medium",
  });

  db.prepare(`
    INSERT INTO duplicates (duplicate_group_key, canonical_key, urls_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(duplicate_group_key) DO UPDATE SET
      canonical_key = excluded.canonical_key,
      urls_json = excluded.urls_json,
      updated_at = excluded.updated_at
  `).run(
    duplicateGroupKey,
    canonicalKey,
    JSON.stringify(uniqueNonEmpty([listing.url, listing.applyUrl, ...listing.sourceUrls])),
    timestamp,
  );

  return { inserted, updated: !inserted, excluded, companyTouched: true, contactsTouched };
}

export function recordRunMetrics(
  db: Database.Database,
  summary: RunSummary,
  sourceBreakdown: Record<string, number>,
): void {
  db.prepare(`
    INSERT INTO run_metrics (
      run_id, started_at, finished_at, total_discovered, total_deduped, total_parsed, fetch_success_rate,
      parse_success_rate, js_fallback_rate, jobs_eligible, companies_discovered, contacts_discovered,
      actionable_count, apply_now_count, cold_email_count, enrich_first_count, watch_count, discard_count,
      direct_contact_companies, founder_surface_companies, average_outreach_leverage_score, source_breakdown_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    summary.runId ?? null,
    nowIso(),
    nowIso(),
    summary.totalFound,
    summary.deduped,
    summary.parsed,
    summary.fetchSuccessRate,
    summary.parseSuccessRate,
    summary.jsFallbackRate,
    summary.totalFound - summary.excluded,
    summary.companiesTouched,
    summary.contactsTouched,
    summary.actionableCount,
    summary.applyNowCount,
    summary.coldEmailCount,
    summary.enrichFirstCount,
    summary.watchCount,
    summary.discardCount,
    summary.directContactCompanies,
    summary.founderSurfaceCompanies,
    summary.averageOutreachLeverageScore,
    JSON.stringify(sourceBreakdown),
  );
}

export function startRunRecord(
  db: Database.Database,
  input: { lane?: string; mode?: string },
): number {
  const timestamp = nowIso();
  const result = db.prepare(`
    INSERT INTO runs (
      started_at, finished_at, status, lane, mode, source_breakdown_json,
      warnings_json, errors_json, artifacts_json, summary_json, created_at, updated_at
    ) VALUES (?, '', 'running', ?, ?, '{}', '[]', '[]', '[]', '{}', ?, ?)
  `).run(timestamp, input.lane ?? "", input.mode ?? "full", timestamp, timestamp);
  return Number(result.lastInsertRowid);
}

export function finishRunRecord(db: Database.Database, runId: number, input: FinishRunInput): RunRecord {
  const timestamp = nowIso();
  db.prepare(`
    UPDATE runs
    SET finished_at = ?,
        status = ?,
        source_breakdown_json = ?,
        warnings_json = ?,
        errors_json = ?,
        artifacts_json = ?,
        summary_json = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    timestamp,
    input.status,
    JSON.stringify(input.sourceBreakdown),
    JSON.stringify(input.warnings),
    JSON.stringify(input.errors),
    JSON.stringify(input.artifacts),
    JSON.stringify(input.summary),
    timestamp,
    runId,
  );
  return getRunById(db, runId)!;
}

export function getRunById(db: Database.Database, runId: number): RunRecord | undefined {
  return db.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as RunRecord | undefined;
}

export function getLatestRun(db: Database.Database): RunRecord | undefined {
  return db.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT 1").get() as RunRecord | undefined;
}

export function listTopJobs(db: Database.Database, limit: number): JobRecord[] {
  return db.prepare(`SELECT * FROM jobs WHERE status = 'analyzed' ORDER BY score DESC, last_seen_at DESC LIMIT ?`).all(limit) as JobRecord[];
}

export function listCompanies(db: Database.Database, limit: number): Array<Record<string, unknown>> {
  return db.prepare(`SELECT * FROM companies ORDER BY startup_score DESC, company_fit_score DESC, updated_at DESC LIMIT ?`).all(limit) as Array<Record<string, unknown>>;
}

export function listContacts(db: Database.Database, companyKey?: string): Array<Record<string, unknown>> {
  if (companyKey) {
    return db.prepare(`
      SELECT ct.*, c.name AS company_name
      FROM contacts ct
      LEFT JOIN companies c ON c.id = ct.company_id
      WHERE c.canonical_key = ?
      ORDER BY ct.confidence DESC, ct.updated_at DESC
    `).all(companyKey) as Array<Record<string, unknown>>;
  }
  return db.prepare(`
    SELECT ct.*, c.name AS company_name
    FROM contacts ct
    LEFT JOIN companies c ON c.id = ct.company_id
    ORDER BY ct.confidence DESC, ct.updated_at DESC
  `).all() as Array<Record<string, unknown>>;
}

export function getJobById(db: Database.Database, jobId: number): JobRecord | undefined {
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as JobRecord | undefined;
}

export function getJobByUrl(db: Database.Database, url: string): JobRecord | undefined {
  return db.prepare("SELECT * FROM jobs WHERE url = ? OR apply_url = ? ORDER BY updated_at DESC LIMIT 1").get(url, url) as JobRecord | undefined;
}

export function updateJobPipelineFields(
  db: Database.Database,
  jobId: number,
  input: {
    pipelineStatus?: PipelineStatus;
    appliedAt?: string;
    applicationMethod?: ApplicationMethod | "";
    applicationUrl?: string;
    assetBundlePath?: string;
    cvAssetPath?: string;
    coverLetterAssetPath?: string;
    outreachNoteAssetPath?: string;
  },
): void {
  db.prepare(`
    UPDATE jobs
    SET pipeline_status = COALESCE(@pipeline_status, pipeline_status),
        applied_at = COALESCE(@applied_at, applied_at),
        application_method = COALESCE(@application_method, application_method),
        application_url = COALESCE(@application_url, application_url),
        asset_bundle_path = COALESCE(@asset_bundle_path, asset_bundle_path),
        cv_asset_path = COALESCE(@cv_asset_path, cv_asset_path),
        cover_letter_asset_path = COALESCE(@cover_letter_asset_path, cover_letter_asset_path),
        outreach_note_asset_path = COALESCE(@outreach_note_asset_path, outreach_note_asset_path),
        updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: jobId,
    pipeline_status: input.pipelineStatus ?? null,
    applied_at: input.appliedAt ?? null,
    application_method: input.applicationMethod ?? null,
    application_url: input.applicationUrl ?? null,
    asset_bundle_path: input.assetBundlePath ?? null,
    cv_asset_path: input.cvAssetPath ?? null,
    cover_letter_asset_path: input.coverLetterAssetPath ?? null,
    outreach_note_asset_path: input.outreachNoteAssetPath ?? null,
    updated_at: nowIso(),
  });
}

export function upsertApplication(
  db: Database.Database,
  input: {
    jobId: number;
    companyId?: number | null;
    status: PipelineStatus;
    method: ApplicationMethod;
    submittedAt?: string;
    notes?: string;
    source?: string;
    assetBundlePath?: string;
  },
): ApplicationRecord {
  const timestamp = nowIso();
  db.prepare(`
    INSERT INTO applications (
      job_id, company_id, status, method, submitted_at, last_updated_at, notes, source, asset_bundle_path, created_at, updated_at
    ) VALUES (
      @job_id, @company_id, @status, @method, @submitted_at, @last_updated_at, @notes, @source, @asset_bundle_path, @created_at, @updated_at
    )
    ON CONFLICT(job_id) DO UPDATE SET
      company_id = COALESCE(excluded.company_id, applications.company_id),
      status = excluded.status,
      method = excluded.method,
      submitted_at = CASE WHEN excluded.submitted_at != '' THEN excluded.submitted_at ELSE applications.submitted_at END,
      last_updated_at = excluded.last_updated_at,
      notes = CASE WHEN excluded.notes != '' THEN excluded.notes ELSE applications.notes END,
      source = CASE WHEN excluded.source != '' THEN excluded.source ELSE applications.source END,
      asset_bundle_path = CASE WHEN excluded.asset_bundle_path != '' THEN excluded.asset_bundle_path ELSE applications.asset_bundle_path END,
      updated_at = excluded.updated_at
  `).run({
    job_id: input.jobId,
    company_id: input.companyId ?? null,
    status: input.status,
    method: input.method,
    submitted_at: input.submittedAt ?? "",
    last_updated_at: timestamp,
    notes: input.notes ?? "",
    source: input.source ?? "",
    asset_bundle_path: input.assetBundlePath ?? "",
    created_at: timestamp,
    updated_at: timestamp,
  });
  return db.prepare("SELECT * FROM applications WHERE job_id = ?").get(input.jobId) as ApplicationRecord;
}

export function addApplicationEvent(
  db: Database.Database,
  input: { applicationId: number; eventType: string; note?: string },
): void {
  db.prepare("INSERT INTO application_events (application_id, event_type, note, created_at) VALUES (?, ?, ?, ?)")
    .run(input.applicationId, input.eventType, input.note ?? "", nowIso());
}

export function getCompanyByRef(db: Database.Database, companyRef: string): Record<string, unknown> | undefined {
  const maybeId = Number(companyRef);
  return Number.isFinite(maybeId)
    ? (db.prepare("SELECT * FROM companies WHERE id = ?").get(maybeId) as Record<string, unknown> | undefined)
    : (db.prepare("SELECT * FROM companies WHERE canonical_key = ? OR lower(name) = lower(?)").get(companyRef, companyRef) as
        | Record<string, unknown>
        | undefined);
}

export function getJobsForCompany(db: Database.Database, companyId: number): Array<Record<string, unknown>> {
  return db.prepare("SELECT * FROM jobs WHERE company_id = ? ORDER BY score DESC, updated_at DESC").all(companyId) as Array<Record<string, unknown>>;
}

export function getContactsForCompanyId(db: Database.Database, companyId: number): Array<Record<string, unknown>> {
  return db.prepare("SELECT * FROM contacts WHERE company_id = ? ORDER BY updated_at DESC").all(companyId) as Array<Record<string, unknown>>;
}

export function logContactAttemptRow(
  db: Database.Database,
  companyId: number,
  channel: ContactChannel,
  note = "",
  jobId?: number,
): ContactLogEntry {
  const createdAt = nowIso();
  const result = db.prepare("INSERT INTO contact_log (company_id, job_id, channel, note, created_at) VALUES (?, ?, ?, ?, ?)").run(
    companyId,
    jobId ?? null,
    channel,
    note,
    createdAt,
  );
  return {
    id: Number(result.lastInsertRowid),
    company_id: companyId,
    job_id: jobId ?? null,
    channel,
    note,
    created_at: createdAt,
  };
}

export function logOutcomeRow(
  db: Database.Database,
  companyId: number,
  result: OutcomeResult,
  note = "",
  jobId?: number,
): OutcomeLogEntry {
  const createdAt = nowIso();
  const insert = db.prepare("INSERT INTO outcome_log (company_id, job_id, result, note, created_at) VALUES (?, ?, ?, ?, ?)").run(
    companyId,
    jobId ?? null,
    result,
    note,
    createdAt,
  );
  return {
    id: Number(insert.lastInsertRowid),
    company_id: companyId,
    job_id: jobId ?? null,
    result,
    note,
    created_at: createdAt,
  };
}

export function listContactLog(db: Database.Database): ContactLogEntry[] {
  return db.prepare("SELECT * FROM contact_log ORDER BY created_at DESC").all() as ContactLogEntry[];
}

export function listContactLogForCompanyId(db: Database.Database, companyId: number): ContactLogEntry[] {
  return db.prepare("SELECT * FROM contact_log WHERE company_id = ? ORDER BY created_at DESC LIMIT 25").all(companyId) as ContactLogEntry[];
}

export function listOutcomeLog(db: Database.Database): OutcomeLogEntry[] {
  return db.prepare("SELECT * FROM outcome_log ORDER BY created_at DESC").all() as OutcomeLogEntry[];
}

export function listOutcomeLogForCompanyId(db: Database.Database, companyId: number): OutcomeLogEntry[] {
  return db.prepare("SELECT * FROM outcome_log WHERE company_id = ? ORDER BY created_at DESC LIMIT 25").all(companyId) as OutcomeLogEntry[];
}

export function saveOutreachDraft(db: Database.Database, jobId: number, draft: string): void {
  db.prepare("UPDATE jobs SET outreach_draft = ?, outreach_state = 'drafted', updated_at = ? WHERE id = ?").run(draft, nowIso(), jobId);
}

export function getStoredSpreadsheetId(db: Database.Database): string {
  const row = db.prepare("SELECT spreadsheet_id FROM sheet_sync_state WHERE scope = 'default'").get() as { spreadsheet_id: string } | undefined;
  return row?.spreadsheet_id ?? "";
}

export function saveSpreadsheetState(
  db: Database.Database,
  spreadsheetId: string,
  fields: { lastSyncAt?: string; lastPullAt?: string; meta?: Record<string, unknown> },
): void {
  const existing = db.prepare("SELECT meta_json FROM sheet_sync_state WHERE scope = 'default'").get() as { meta_json: string } | undefined;
  const meta = fields.meta ?? (existing ? JSON.parse(existing.meta_json || "{}") : {});
  db.prepare(`
    INSERT INTO sheet_sync_state (scope, spreadsheet_id, last_sync_at, last_pull_at, meta_json)
    VALUES ('default', ?, ?, ?, ?)
    ON CONFLICT(scope) DO UPDATE SET
      spreadsheet_id = excluded.spreadsheet_id,
      last_sync_at = excluded.last_sync_at,
      last_pull_at = excluded.last_pull_at,
      meta_json = excluded.meta_json
  `).run(spreadsheetId, fields.lastSyncAt ?? "", fields.lastPullAt ?? "", JSON.stringify(meta));
}

export function updateJobManualFields(
  db: Database.Database,
  canonicalKey: string,
  fields: Partial<Pick<JobRecord, "manual_status" | "owner_notes" | "priority" | "outreach_state" | "manual_contact_override">>,
): boolean {
  const result = db.prepare(`
    UPDATE jobs
    SET manual_status = COALESCE(@manual_status, manual_status),
        owner_notes = COALESCE(@owner_notes, owner_notes),
        priority = COALESCE(@priority, priority),
        outreach_state = COALESCE(@outreach_state, outreach_state),
        manual_contact_override = COALESCE(@manual_contact_override, manual_contact_override),
        updated_at = @updated_at
    WHERE canonical_key = @canonical_key
  `).run({
    canonical_key: canonicalKey,
    manual_status: fields.manual_status ?? null,
    owner_notes: fields.owner_notes ?? null,
    priority: fields.priority ?? null,
    outreach_state: fields.outreach_state ?? null,
    manual_contact_override: fields.manual_contact_override ?? null,
    updated_at: nowIso(),
  });
  return result.changes > 0;
}

export function summarizeRun(params: {
  runId?: number;
  status?: RunStatus;
  totalFound: number;
  totalNew: number;
  totalUpdated: number;
  excluded: number;
  companiesTouched: number;
  contactsTouched: number;
  deduped: number;
  parsed: number;
  fetchSuccessRate: number;
  parseSuccessRate: number;
  jsFallbackRate: number;
  actionableCount?: number;
  applyNowCount?: number;
  coldEmailCount?: number;
  enrichFirstCount?: number;
  watchCount?: number;
  discardCount?: number;
  directContactCompanies?: number;
  founderSurfaceCompanies?: number;
  averageOutreachLeverageScore?: number;
  warnings?: string[];
  errors?: string[];
}): RunSummary {
  return {
    ...params,
    runId: params.runId,
    status: params.status,
    actionableCount: params.actionableCount ?? 0,
    applyNowCount: params.applyNowCount ?? 0,
    coldEmailCount: params.coldEmailCount ?? 0,
    enrichFirstCount: params.enrichFirstCount ?? 0,
    watchCount: params.watchCount ?? 0,
    discardCount: params.discardCount ?? 0,
    directContactCompanies: params.directContactCompanies ?? 0,
    founderSurfaceCompanies: params.founderSurfaceCompanies ?? 0,
    averageOutreachLeverageScore: params.averageOutreachLeverageScore ?? 0,
    warnings: params.warnings ?? [],
    errors: params.errors ?? [],
  };
}
