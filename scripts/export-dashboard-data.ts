import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config.ts";
import { getStoredSpreadsheetId, openDatabase } from "../src/db.ts";
import { resolveCompanyBestContact } from "../src/company-enrich.ts";

type JsonRecord = Record<string, unknown>;

type DashboardReachPoint = {
  kind: "email" | "careers" | "contact" | "linkedin" | "website";
  label: string;
  value: string;
};

type DashboardCompany = {
  id: number;
  name: string;
  category: string;
  route: string;
  priority: string;
  stage: string;
  location: string;
  description: string;
  companyUrl: string;
  careersUrl: string;
  contactUrl: string;
  linkedinUrl: string;
  bestContact: string;
  reachPoints: DashboardReachPoint[];
  directContactCount: number;
  startupSignals: string[];
  hiringSignals: string[];
  recommendationReason: string;
  pitchAngle: string;
  updatedAt: string;
};

type DashboardJob = {
  id: number;
  title: string;
  companyName: string;
  category: string;
  route: string;
  pipelineStatus: string;
  location: string;
  workModel: string;
  source: string;
  sourceType: string;
  url: string;
  applyUrl: string;
  bestContact: string;
  postedAt: string;
  updatedAt: string;
};

type OutreachItem = {
  type: "email" | "application";
  companyName: string;
  jobTitle: string;
  route: string;
  status: string;
  target: string;
  note: string;
  timestamp: string;
};

type PipelineItem = {
  stage: "talking" | "rejected" | "applied" | "contacted";
  companyName: string;
  jobTitle: string;
  detail: string;
  target: string;
  timestamp: string;
};

function parseJsonList(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function safeNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function isEmail(value: string): boolean {
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value);
}

function isPlaceholderEmail(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.endsWith("@example.com") ||
    lower.includes("max.mustermann") ||
    lower.includes("john.doe") ||
    lower.includes("jane.doe") ||
    lower.includes("noreply") ||
    lower.includes("no-reply") ||
    lower.includes("do-not-reply")
  );
}

function isWeakOutreachEmail(value: string): boolean {
  const localPart = value.toLowerCase().split("@")[0] ?? "";
  return /^(support|help|privacy|legal|security|abuse|billing|payment|press|media|accommodations?|reasonable-accommodations?)$/.test(localPart);
}

function contactScore(value: string): number {
  if (!value) return 0;
  if (!isEmail(value)) return 1;
  if (isPlaceholderEmail(value)) return -100;
  if (isWeakOutreachEmail(value)) return 1;
  const localPart = value.toLowerCase().split("@")[0] ?? "";
  if (/^(founders?|ceo|team|people|talent|jobs|careers|work)$/.test(localPart)) return 5;
  if (/^(hello|contact|info)$/.test(localPart)) return 4;
  return 3;
}

function domainFromValue(value: string): string {
  if (isEmail(value)) return value.split("@")[1]?.toLowerCase().replace(/^www\./, "") ?? "";
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function stripTracking(value: string): string {
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(trk|trackingId|refId|position|pageNum|utm_|lipi|originalSubdomain)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return value;
  }
}

function isNoisyLinkedIn(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    /linkedin\.com\/jobs\/view\//.test(lower) ||
    /linkedin\.com\/jobs\/[^/]+-stellen/.test(lower) ||
    /public_jobs_(similar-jobs|people-also-viewed|linkster_link)/.test(lower)
  );
}

function isAggregatorDomain(domain: string): boolean {
  return /(^|\.)linkedin\.com$|(^|\.)join\.com$|(^|\.)uiuxdesignerjobs\.com$|(^|\.)berlinstartupjobs\.com$|(^|\.)startup\.jobs$/i.test(domain);
}

function isLikelySameCompany(value: string, company: JsonRecord): boolean {
  if (!value) return false;
  if (isEmail(value)) {
    const emailDomain = domainFromValue(value);
    const companyDomain = safeString(company.domain).toLowerCase().replace(/^www\./, "");
    return !companyDomain || emailDomain === companyDomain;
  }
  const valueDomain = domainFromValue(value);
  const companyDomain = safeString(company.domain).toLowerCase().replace(/^www\./, "");
  const companyName = safeString(company.name).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!companyDomain || !valueDomain) return true;
  if (isAggregatorDomain(companyDomain)) {
    return companyName.length > 2 && value.toLowerCase().replace(/[^a-z0-9]/g, "").includes(companyName);
  }
  if (valueDomain === companyDomain) return true;
  if (/linkedin\.com$/.test(valueDomain)) {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "").includes(companyName);
  }
  return false;
}

function reachPointKind(value: string): DashboardReachPoint["kind"] {
  if (isEmail(value)) return "email";
  if (/linkedin\.com/i.test(value)) return "linkedin";
  if (/\/(careers?|jobs?|join)(\/|$)/i.test(value)) return "careers";
  if (/\/(contact|imprint|legal|privacy|team|about)(\/|$)/i.test(value)) return "contact";
  return "website";
}

function reachPointLabel(kind: DashboardReachPoint["kind"], value: string): string {
  if (kind === "email") return value;
  if (kind === "careers") return "Careers page";
  if (kind === "contact") return "Contact page";
  if (kind === "linkedin") return "LinkedIn";
  return "Website";
}

function reachPointRank(point: DashboardReachPoint): number {
  switch (point.kind) {
    case "email":
      return 5;
    case "careers":
      return 4;
    case "contact":
      return 3;
    case "linkedin":
      return 2;
    case "website":
      return 1;
  }
}

function rowHash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function readDbHash(baseDir: string): string {
  const dbPath = path.join(baseDir, "data", "sniper.db");
  return crypto.createHash("sha256").update(fs.readFileSync(dbPath)).digest("hex");
}

function companyReachPoints(company: JsonRecord, companyContacts: JsonRecord[]): DashboardReachPoint[] {
  const rawValues = unique([
    ...companyContacts.map((contact) => safeString(contact.email || contact.linkedin_url || contact.source_url)),
    ...parseJsonList(company.public_contacts),
    safeString(company.contact_url),
    safeString(company.team_url),
    safeString(company.linkedin_url),
    safeString(company.careers_url),
    safeString(company.company_url),
  ]);

  const points = new Map<string, DashboardReachPoint>();
  for (const rawValue of rawValues) {
    const value = stripTracking(rawValue.trim());
    if (!value) continue;
    if (isNoisyLinkedIn(value)) continue;
    if (isEmail(value) && (isPlaceholderEmail(value) || isWeakOutreachEmail(value))) continue;
    if (!isLikelySameCompany(value, company)) continue;
    const kind = reachPointKind(value);
    points.set(value, { kind, label: reachPointLabel(kind, value), value });
  }

  return [...points.values()]
    .sort((left, right) => reachPointRank(right) - reachPointRank(left) || contactScore(right.value) - contactScore(left.value) || left.value.localeCompare(right.value))
    .slice(0, 5);
}

function companyBestContact(company: JsonRecord, companyContacts: JsonRecord[]): string {
  const direct = companyContacts
    .map((contact) => safeString(contact.email).trim())
    .filter((email) => email && !isPlaceholderEmail(email) && !isWeakOutreachEmail(email) && isLikelySameCompany(email, company))
    .sort((left, right) => contactScore(right) - contactScore(left))[0];
  if (direct) return direct;
  const best = resolveCompanyBestContact(company);
  if (!best || isNoisyLinkedIn(best) || (isEmail(best) && (isPlaceholderEmail(best) || isWeakOutreachEmail(best))) || !isLikelySameCompany(best, company)) {
    return "";
  }
  return stripTracking(best);
}

function derivePipelineStage(job: JsonRecord, app: JsonRecord | undefined, outcome: JsonRecord | undefined, contact: JsonRecord | undefined): PipelineItem["stage"] | null {
  const jobStage = safeString(job.pipeline_status);
  const outcomeResult = safeString(outcome?.result);
  if (outcomeResult === "rejected" || jobStage === "rejected") return "rejected";
  if (["reply", "call", "interview", "positive_signal"].includes(outcomeResult) || ["reply_received", "interviewing"].includes(jobStage)) {
    return "talking";
  }
  if (safeString(app?.status) === "applied" || jobStage === "applied") return "applied";
  if (contact || jobStage === "contacted") return "contacted";
  return null;
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function main() {
  const baseDir = path.resolve(process.cwd());
  const { db } = openDatabase(baseDir);
  const config = loadConfig(baseDir);
  const generatedAt = new Date().toISOString();
  const spreadsheetId = config.sheets.spreadsheetId || getStoredSpreadsheetId(db) || process.env.SNIPER_GOOGLE_SHEET_ID || "";

  const companies = db.prepare("SELECT * FROM companies ORDER BY CASE priority_band WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC, company_fit_score DESC, updated_at DESC").all() as JsonRecord[];
  const contacts = db.prepare("SELECT * FROM contacts ORDER BY updated_at DESC").all() as JsonRecord[];
  const jobs = db.prepare("SELECT * FROM jobs ORDER BY updated_at DESC").all() as JsonRecord[];
  const applications = db.prepare("SELECT * FROM applications ORDER BY updated_at DESC").all() as JsonRecord[];
  const contactLogs = db.prepare(`
    SELECT cl.*, c.name AS company_name, j.title AS job_title
    FROM contact_log cl
    LEFT JOIN companies c ON c.id = cl.company_id
    LEFT JOIN jobs j ON j.id = cl.job_id
    ORDER BY cl.created_at DESC
  `).all() as JsonRecord[];
  const outcomeLogs = db.prepare(`
    SELECT ol.*, c.name AS company_name, j.title AS job_title
    FROM outcome_log ol
    LEFT JOIN companies c ON c.id = ol.company_id
    LEFT JOIN jobs j ON j.id = ol.job_id
    ORDER BY ol.created_at DESC
  `).all() as JsonRecord[];

  const contactsByCompanyId = new Map<number, JsonRecord[]>();
  for (const contact of contacts) {
    const companyId = safeNumber(contact.company_id);
    if (!companyId) continue;
    const existing = contactsByCompanyId.get(companyId) ?? [];
    existing.push(contact);
    contactsByCompanyId.set(companyId, existing);
  }

  const appsByJobId = new Map<number, JsonRecord>();
  for (const app of applications) {
    const jobId = safeNumber(app.job_id);
    if (jobId) appsByJobId.set(jobId, app);
  }

  const latestContactByJobId = new Map<number, JsonRecord>();
  const latestOutcomeByJobId = new Map<number, JsonRecord>();
  for (const log of contactLogs) {
    const jobId = safeNumber(log.job_id);
    if (jobId && !latestContactByJobId.has(jobId)) latestContactByJobId.set(jobId, log);
  }
  for (const log of outcomeLogs) {
    const jobId = safeNumber(log.job_id);
    if (jobId && !latestOutcomeByJobId.has(jobId)) latestOutcomeByJobId.set(jobId, log);
  }

  const companyViews: DashboardCompany[] = companies.map((company) => {
    const companyId = safeNumber(company.id);
    const companyContacts = contactsByCompanyId.get(companyId) ?? [];
    return {
      id: companyId,
      name: safeString(company.name),
      category: safeString(company.recommendation || "watch"),
      route: safeString(company.best_route || "watch_company"),
      priority: safeString(company.priority_band || "low"),
      stage: safeString(company.stage_text),
      location: safeString(company.location),
      description: safeString(company.description),
      companyUrl: safeString(company.company_url),
      careersUrl: safeString(company.careers_url),
      contactUrl: safeString(company.contact_url),
      linkedinUrl: safeString(company.linkedin_url),
      bestContact: companyBestContact(company, companyContacts),
      reachPoints: companyReachPoints(company, companyContacts),
      directContactCount: safeNumber(company.direct_contact_count),
      startupSignals: parseJsonList(company.startup_signals),
      hiringSignals: parseJsonList(company.hiring_signals),
      recommendationReason: safeString(company.recommendation_reason),
      pitchAngle: safeString(company.pitch_angle),
      updatedAt: safeString(company.updated_at),
    };
  });

  const companyBestContactByName = new Map(companyViews.map((company) => [company.name, company.bestContact]));

  const jobViews: DashboardJob[] = jobs.map((job) => ({
    id: safeNumber(job.id),
    title: safeString(job.title),
    companyName: safeString(job.company_name),
    category: safeString(job.recommendation),
    route: safeString(job.recommended_route),
    pipelineStatus: safeString(job.pipeline_status),
    location: safeString(job.location),
    workModel: safeString(job.work_model),
    source: safeString(job.source),
    sourceType: safeString(job.source_type),
    url: safeString(job.url),
    applyUrl: safeString(job.apply_url || job.url),
    bestContact: companyBestContactByName.get(safeString(job.company_name)) ?? "",
    postedAt: safeString(job.posted_at),
    updatedAt: safeString(job.updated_at),
  }));

  const activeJobs = jobViews.filter((job) => !["discard"].includes(job.category) && !["applied", "rejected", "archived"].includes(job.pipelineStatus));

  const outreach: OutreachItem[] = [
    ...contactLogs.map((log) => ({
      type: "email" as const,
      companyName: safeString(log.company_name),
      jobTitle: safeString(log.job_title),
      route: safeString(log.channel),
      status: "sent",
      target: companyBestContactByName.get(safeString(log.company_name)) ?? "",
      note: safeString(log.note),
      timestamp: safeString(log.created_at),
    })),
    ...applications.map((app) => {
      const job = jobs.find((row) => safeNumber(row.id) === safeNumber(app.job_id));
      return {
        type: "application" as const,
        companyName: safeString(job?.company_name),
        jobTitle: safeString(job?.title),
        route: safeString(app.method),
        status: safeString(app.status),
        target: safeString(job?.apply_url || job?.url),
        note: safeString(app.notes),
        timestamp: safeString(app.submitted_at || app.created_at),
      };
    }),
  ].sort((left, right) => right.timestamp.localeCompare(left.timestamp));

  const pipeline: PipelineItem[] = jobs
    .map((job) => {
      const jobId = safeNumber(job.id);
      const app = appsByJobId.get(jobId);
      const contact = latestContactByJobId.get(jobId);
      const outcome = latestOutcomeByJobId.get(jobId);
      const stage = derivePipelineStage(job, app, outcome, contact);
      if (!stage) return null;
      return {
        stage,
        companyName: safeString(job.company_name),
        jobTitle: safeString(job.title),
        detail: safeString(outcome?.note || app?.notes || contact?.note || job.recommendation_reason),
        target: safeString(job.apply_url || job.url),
        timestamp: safeString(outcome?.created_at || app?.submitted_at || contact?.created_at || job.updated_at),
      } satisfies PipelineItem;
    })
    .filter((item): item is PipelineItem => Boolean(item))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));

  const summary = {
    companies: companyViews.length,
    directContacts: companyViews.filter((company) => company.directContactCount > 0 || company.bestContact.includes("@")).length,
    activeJobs: activeJobs.length,
    sentEmails: outreach.filter((item) => item.type === "email").length,
    applications: outreach.filter((item) => item.type === "application").length,
    talking: pipeline.filter((item) => item.stage === "talking").length,
    rejected: pipeline.filter((item) => item.stage === "rejected").length,
    applied: pipeline.filter((item) => item.stage === "applied").length,
    contacted: pipeline.filter((item) => item.stage === "contacted").length,
  };

  const payload = {
    generatedAt,
    dbHash: readDbHash(baseDir),
    snapshotHash: rowHash({ companyViews, activeJobs, outreach, pipeline }),
    sheet: spreadsheetId
      ? { spreadsheetId, url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` }
      : null,
    summary,
    companies: companyViews,
    activeJobs,
    outreach,
    pipeline,
  };

  const outputDir = path.join(baseDir, "dashboard", "data");
  ensureDir(outputDir);
  fs.writeFileSync(path.join(outputDir, "dashboard.json"), `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(
    path.join(outputDir, "sync-state.json"),
    `${JSON.stringify(
      {
        generatedAt,
        dbHash: payload.dbHash,
        snapshotHash: payload.snapshotHash,
        summary,
      },
      null,
      2,
    )}\n`,
  );

  console.log(JSON.stringify({ outputDir, generatedAt, summary }, null, 2));
}

main();
