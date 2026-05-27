import fs from "node:fs";
import { resolveImportPath } from "../lib/paths.js";
import { domainFromUrl } from "../lib/url.js";
import { openDatabase, updateJobPipelineFields, upsertCompanyOutreachState } from "../state/db.js";
import type { GmailAuditEntry, GmailAuditStatus } from "./daily-types.js";

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function inferAuditEvent(entry: GmailAuditEntry): "contacted" | "applied" | undefined {
  if (entry.inferredEvent) return entry.inferredEvent;
  const subject = normalize(entry.subject);
  const from = normalize(entry.from);
  const to = normalize(entry.to);
  if (
    entry.kind === "received" &&
    (/thank you for applying|application received|application confirmation/.test(subject) ||
      /greenhouse\.io|lever\.co|ashbyhq\.com|workablemail\.com|join\.com|smartrecruiters\.com|personio\.com|bamboohr\.com|recruitee\.com|workday\.com|successfactors\.com/.test(from))
  ) {
    return "applied";
  }
  if (
    entry.kind === "sent" &&
    (/application/.test(subject) ||
      /jobs@|careers@|hello@/.test(to))
  ) {
    return subject.includes("application") ? "applied" : "contacted";
  }
  return undefined;
}

function resolveCompanyDomain(entry: GmailAuditEntry): string {
  if (entry.companyDomain) return entry.companyDomain.toLowerCase();
  const recipient = entry.kind === "sent" ? entry.to : entry.from;
  if (recipient.includes("@")) return recipient.split("@")[1]!.toLowerCase();
  return domainFromUrl(recipient);
}

export function importGmailAudit(baseDir: string): GmailAuditStatus {
  const auditPath = resolveImportPath(baseDir, "gmail-audit.json");
  const status: GmailAuditStatus = {
    fileFound: fs.existsSync(auditPath),
    importedSignals: 0,
    appliedMutations: 0,
    contactedMutations: 0,
    warnings: [],
  };
  if (!status.fileFound) {
    return status;
  }

  const { db } = openDatabase(baseDir);
  let entries: GmailAuditEntry[] = [];
  try {
    entries = JSON.parse(fs.readFileSync(auditPath, "utf8")) as GmailAuditEntry[];
  } catch (error) {
    status.warnings.push(`Failed to parse Gmail audit JSON: ${error instanceof Error ? error.message : String(error)}`);
    return status;
  }

  for (const entry of entries) {
    status.importedSignals += 1;
    const event = inferAuditEvent(entry);
    if (!event) {
      status.warnings.push(`Ignored ambiguous Gmail audit entry: ${entry.subject}`);
      continue;
    }

    const domain = resolveCompanyDomain(entry);
    const company = domain
      ? (db
          .prepare("SELECT id, name FROM companies WHERE lower(domain) = lower(?) OR lower(company_url) LIKE ? LIMIT 1")
          .get(domain, `%${domain}%`) as { id: number; name: string } | undefined)
      : entry.companyName
        ? (db.prepare("SELECT id, name FROM companies WHERE lower(name) = lower(?) LIMIT 1").get(entry.companyName) as
            | { id: number; name: string }
            | undefined)
        : undefined;

    if (!company) {
      status.warnings.push(`No company match for Gmail audit entry: ${entry.subject}`);
      continue;
    }

    if (event === "contacted") {
      upsertCompanyOutreachState(db, {
        companyId: company.id,
        status: "sent_email",
        lastContactChannel: "email",
        note: entry.evidenceSummary,
        source: "gmail_audit",
      });
      db.prepare(`
        UPDATE jobs
        SET pipeline_status = CASE
          WHEN pipeline_status IN ('applied', 'reply_received', 'interviewing', 'rejected', 'archived') THEN pipeline_status
          ELSE 'contacted'
        END,
        updated_at = datetime('now')
        WHERE company_id = ?
      `).run(company.id);
      status.contactedMutations += 1;
      continue;
    }

    upsertCompanyOutreachState(db, {
      companyId: company.id,
      status: "applied",
      lastContactChannel: "email",
      note: entry.evidenceSummary,
      source: "gmail_audit",
    });
    const jobs = db.prepare("SELECT id FROM jobs WHERE company_id = ? ORDER BY score DESC, updated_at DESC").all(company.id) as Array<{ id: number }>;
    for (const job of jobs) {
      updateJobPipelineFields(db, job.id, {
        pipelineStatus: "applied",
        appliedAt: entry.date,
        applicationMethod: "direct_email",
      });
    }
    status.appliedMutations += 1;
  }

  return status;
}
