import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config.js";
import { getStoredSpreadsheetId, openDatabase } from "../src/db.js";
import { buildCompanyOutreachSnapshots } from "../src/outreach-state.js";
import { resolveCompanyBestContact } from "../src/company-enrich.js";
import { isEmail, isPlaceholderEmail, isWeakOutreachEmail, scoreContactCandidate } from "../src/normalization/contact-quality.js";

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
  outreachStatus: string;
  lastContactChannel: string;
  latestActivityAt: string;
  latestStatusNote: string;
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
  stage: "talking" | "rejected" | "applied" | "sent_email" | "reached";
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

function contactScore(value: string): number {
  if (!value) return 0;
  if (!isEmail(value)) return 1;
  if (isPlaceholderEmail(value)) return -100;
  const contact = {
    kind: "general_contact_email",
    name: "",
    title: "",
    email: value,
    linkedinUrl: "",
    sourceUrl: "",
    confidence: "medium",
    evidenceType: "export_projection",
    evidenceExcerpt: value,
    isPublic: true,
    pageType: "generic",
  } as const;
  return scoreContactCandidate(domainFromValue(value), contact);
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

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function outreachDedupKey(item: OutreachItem): string {
  return [
    item.type,
    safeString(item.companyName).trim().toLowerCase(),
    safeString(item.jobTitle).trim().toLowerCase(),
    safeString(item.route).trim().toLowerCase(),
    safeString(item.status).trim().toLowerCase(),
  ].join("::");
}

export function generateDashboardData(baseDir = path.resolve(process.cwd())) {
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

  const companyOutreach = buildCompanyOutreachSnapshots(db);
  const companyOutreachById = new Map(companyOutreach.map((snapshot) => [snapshot.companyId, snapshot]));

  const companyViews: DashboardCompany[] = companies.map((company) => {
    const companyId = safeNumber(company.id);
    const companyContacts = contactsByCompanyId.get(companyId) ?? [];
    const outreach = companyOutreachById.get(companyId);
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
      outreachStatus: outreach?.status ?? "new",
      lastContactChannel: outreach?.lastContactChannel ?? "",
      latestActivityAt: outreach?.latestActivityAt ?? "",
      latestStatusNote: outreach?.latestNote ?? "",
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

  const outreach = [
    ...companyOutreach
      .filter((snapshot) => snapshot.status === "sent_email")
      .map((snapshot) => ({
      type: "email" as const,
      companyName: snapshot.companyName,
      jobTitle: jobs.find((job) => safeNumber(job.id) === (snapshot.lastJobId ?? 0)) ? safeString(jobs.find((job) => safeNumber(job.id) === (snapshot.lastJobId ?? 0))?.title) : "",
      route: snapshot.lastContactChannel || "email",
      status: "sent",
      target: companyBestContactByName.get(snapshot.companyName) ?? "",
      note: snapshot.latestNote,
      timestamp: snapshot.latestActivityAt,
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
  ]
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .reduce<OutreachItem[]>((items, item) => {
      const key = outreachDedupKey(item);
      if (items.some((existing) => outreachDedupKey(existing) === key)) {
        return items;
      }
      items.push(item);
      return items;
    }, []);

  const pipeline: PipelineItem[] = jobs
    .map((job) => {
      const companySnapshot = companyOutreachById.get(safeNumber(job.company_id));
      const stage = companySnapshot?.status;
      if (!stage || !["talking", "rejected", "applied", "sent_email", "reached"].includes(stage)) return null;
      return {
        stage: stage as PipelineItem["stage"],
        companyName: safeString(job.company_name),
        jobTitle: safeString(job.title),
        detail: companySnapshot?.latestNote || safeString(job.recommendation_reason),
        target: safeString(job.apply_url || job.url),
        timestamp: companySnapshot?.latestActivityAt || safeString(job.updated_at),
      } satisfies PipelineItem;
    })
    .filter((item): item is PipelineItem => Boolean(item))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp));

  const companyStatusSummary = {
    reached: companyOutreach.filter((item) => item.status === "reached").length,
    sentEmail: companyOutreach.filter((item) => item.status === "sent_email").length,
    applied: companyOutreach.filter((item) => item.status === "applied").length,
    talking: companyOutreach.filter((item) => item.status === "talking").length,
    rejected: companyOutreach.filter((item) => item.status === "rejected").length,
    archived: companyOutreach.filter((item) => item.status === "archived").length,
  };

  const summary = {
    companies: companyViews.length,
    directContacts: companyViews.filter((company) => company.directContactCount > 0 || company.bestContact.includes("@")).length,
    activeJobs: activeJobs.length,
    reached: companyStatusSummary.reached,
    sentEmails: companyStatusSummary.sentEmail,
    applications: companyStatusSummary.applied,
    talking: companyStatusSummary.talking,
    rejected: companyStatusSummary.rejected,
    applied: companyStatusSummary.applied,
    contacted: companyStatusSummary.sentEmail,
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
    companyOutreach,
  };

  const outputDir = path.join(baseDir, "dashboard", "data");
  ensureDir(outputDir);
  fs.writeFileSync(path.join(outputDir, "dashboard.json"), `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, "outreach-status.json"), `${JSON.stringify(companyOutreach, null, 2)}\n`);
  fs.writeFileSync(
    path.join(outputDir, "outreach-status.md"),
    [
      "# Outreach Status",
      "",
      `Generated: ${generatedAt}`,
      "",
      "## Sent Email",
      ...companyOutreach.filter((item) => item.status === "sent_email").map((item) => `- ${item.companyName} | ${item.lastContactChannel || "email"} | ${item.latestActivityAt}`),
      "",
      "## Applied",
      ...companyOutreach.filter((item) => item.status === "applied").map((item) => `- ${item.companyName} | ${item.latestActivityAt}`),
      "",
      "## Talking",
      ...companyOutreach.filter((item) => item.status === "talking").map((item) => `- ${item.companyName} | ${item.latestActivityAt}`),
      "",
      "## Rejected",
      ...companyOutreach.filter((item) => item.status === "rejected").map((item) => `- ${item.companyName} | ${item.latestActivityAt}`),
      "",
      "## Reached",
      ...companyOutreach.filter((item) => item.status === "reached").map((item) => `- ${item.companyName} | ${item.latestActivityAt}`),
      "",
    ].join("\n"),
  );
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
  return payload;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  generateDashboardData();
}
