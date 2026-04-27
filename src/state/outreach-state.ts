import type Database from "better-sqlite3";
import type {
  CompanyOutreachSnapshot,
  CompanyOutreachStateRecord,
  ContactChannel,
  OutreachStatus,
} from "../types.js";

const STATUS_RANK: Record<OutreachStatus, number> = {
  new: 0,
  reached: 1,
  sent_email: 2,
  applied: 3,
  talking: 4,
  rejected: 5,
  archived: 6,
};

type JsonRecord = Record<string, unknown>;

function safeString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function safeNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function maxStatus(left: OutreachStatus, right: OutreachStatus): OutreachStatus {
  return STATUS_RANK[right] > STATUS_RANK[left] ? right : left;
}

function pipelineToStatus(value: string): OutreachStatus {
  if (value === "rejected") return "rejected";
  if (value === "interviewing" || value === "reply_received") return "talking";
  if (value === "applied") return "applied";
  if (value === "contacted") return "sent_email";
  if (value === "archived") return "archived";
  return "new";
}

function outcomeToStatus(value: string): OutreachStatus {
  if (value === "rejected") return "rejected";
  if (["reply", "call", "interview", "positive_signal"].includes(value)) return "talking";
  return "new";
}

type CompanySignal = {
  status: OutreachStatus;
  timestamp: string;
  note: string;
  channel: ContactChannel | "";
  jobId: number | null;
  source: string;
};

function strongestSignal(signals: CompanySignal[]): CompanySignal {
  return signals.reduce((best, current) => {
    const bestRank = STATUS_RANK[best.status];
    const currentRank = STATUS_RANK[current.status];
    if (currentRank !== bestRank) {
      return currentRank > bestRank ? current : best;
    }
    return current.timestamp > best.timestamp ? current : best;
  });
}

export function buildCompanyOutreachSnapshots(db: Database.Database): CompanyOutreachSnapshot[] {
  const companies = db.prepare("SELECT id, name FROM companies ORDER BY updated_at DESC").all() as JsonRecord[];
  const explicitRows = db.prepare("SELECT * FROM company_outreach_state ORDER BY updated_at DESC").all() as CompanyOutreachStateRecord[];
  const jobs = db.prepare("SELECT id, company_id, pipeline_status, updated_at FROM jobs ORDER BY updated_at DESC").all() as JsonRecord[];
  const applications = db.prepare("SELECT job_id, company_id, status, method, submitted_at, last_updated_at, notes FROM applications ORDER BY updated_at DESC").all() as JsonRecord[];
  const contactLogs = db.prepare("SELECT company_id, job_id, channel, note, created_at FROM contact_log ORDER BY created_at DESC").all() as JsonRecord[];
  const outcomeLogs = db.prepare("SELECT company_id, job_id, result, note, created_at FROM outcome_log ORDER BY created_at DESC").all() as JsonRecord[];

  const byCompanyId = new Map<number, CompanySignal[]>();
  const push = (companyId: number, signal: CompanySignal) => {
    if (!companyId) return;
    const signals = byCompanyId.get(companyId) ?? [];
    signals.push(signal);
    byCompanyId.set(companyId, signals);
  };

  for (const row of explicitRows) {
    push(row.company_id, {
      status: row.status,
      timestamp: row.updated_at,
      note: row.note,
      channel: row.last_contact_channel,
      jobId: row.last_job_id,
      source: row.source || "explicit_state",
    });
  }

  for (const row of jobs) {
    const status = pipelineToStatus(safeString(row.pipeline_status));
    if (status === "new") continue;
    push(safeNumber(row.company_id), {
      status,
      timestamp: safeString(row.updated_at),
      note: "",
      channel: status === "sent_email" ? "email" : "",
      jobId: safeNumber(row.id) || null,
      source: "job_pipeline",
    });
  }

  for (const row of applications) {
    const companyId = safeNumber(row.company_id);
    const status = safeString(row.status) === "applied" ? "applied" : pipelineToStatus(safeString(row.status));
    if (status === "new") continue;
    push(companyId, {
      status,
      timestamp: safeString(row.submitted_at || row.last_updated_at),
      note: safeString(row.notes),
      channel: safeString(row.method) === "direct_email" ? "email" : safeString(row.method) === "founder_reachout" ? "founder" : safeString(row.method) === "linkedin" ? "linkedin" : safeString(row.method) === "ats" ? "ats" : "",
      jobId: safeNumber(row.job_id) || null,
      source: "application",
    });
  }

  for (const row of contactLogs) {
    push(safeNumber(row.company_id), {
      status: "sent_email",
      timestamp: safeString(row.created_at),
      note: safeString(row.note),
      channel: safeString(row.channel) as ContactChannel,
      jobId: safeNumber(row.job_id) || null,
      source: "contact_log",
    });
  }

  for (const row of outcomeLogs) {
    const status = outcomeToStatus(safeString(row.result));
    if (status === "new") continue;
    push(safeNumber(row.company_id), {
      status,
      timestamp: safeString(row.created_at),
      note: safeString(row.note),
      channel: "",
      jobId: safeNumber(row.job_id) || null,
      source: "outcome_log",
    });
  }

  return companies.map((company) => {
    const companyId = safeNumber(company.id);
    const signals = byCompanyId.get(companyId) ?? [];
    if (!signals.length) {
      return {
        companyId,
        companyName: safeString(company.name),
        status: "new",
        lastContactChannel: "",
        lastJobId: null,
        latestNote: "",
        latestActivityAt: "",
        source: "none",
      } satisfies CompanyOutreachSnapshot;
    }
    const strongest = strongestSignal(signals);
    const latestActivityAt = signals.reduce((latest, signal) => (signal.timestamp > latest ? signal.timestamp : latest), "");
    return {
      companyId,
      companyName: safeString(company.name),
      status: signals.reduce<OutreachStatus>((current, signal) => maxStatus(current, signal.status), "new"),
      lastContactChannel: strongest.channel,
      lastJobId: strongest.jobId,
      latestNote: strongest.note,
      latestActivityAt,
      source: strongest.source,
    } satisfies CompanyOutreachSnapshot;
  });
}

export function companyOutreachSnapshotMap(db: Database.Database): Map<number, CompanyOutreachSnapshot> {
  return new Map(buildCompanyOutreachSnapshots(db).map((snapshot) => [snapshot.companyId, snapshot]));
}
