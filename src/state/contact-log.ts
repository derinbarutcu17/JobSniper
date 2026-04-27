import type Database from "better-sqlite3";
import type { ContactChannel, ContactLogEntry, OutcomeLogEntry, OutcomeResult } from "../types.js";

function resolveCompanyAndJob(
  db: Database.Database,
  companyRef: string,
  jobId?: number,
): { companyId: number; jobId: number | null; companyName: string } {
  const maybeId = Number(companyRef);
  const company = Number.isFinite(maybeId)
    ? (db.prepare("SELECT id, name FROM companies WHERE id = ?").get(maybeId) as { id: number; name: string } | undefined)
    : (db.prepare("SELECT id, name FROM companies WHERE canonical_key = ? OR lower(name) = lower(?)").get(companyRef, companyRef) as
        | { id: number; name: string }
        | undefined);
  if (!company) {
    throw new Error(`Company not found: ${companyRef}`);
  }
  return { companyId: company.id, jobId: jobId ?? null, companyName: company.name };
}

export function logContactAttempt(
  db: Database.Database,
  companyRef: string,
  channel: ContactChannel,
  note = "",
  jobId?: number,
): ContactLogEntry {
  const resolved = resolveCompanyAndJob(db, companyRef, jobId);
  const createdAt = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO contact_log (company_id, job_id, channel, note, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(resolved.companyId, resolved.jobId, channel, note, createdAt);
  return {
    id: Number(result.lastInsertRowid),
    company_id: resolved.companyId,
    job_id: resolved.jobId,
    channel,
    note,
    created_at: createdAt,
  };
}

export function logOutcome(
  db: Database.Database,
  companyRef: string,
  result: OutcomeResult,
  note = "",
  jobId?: number,
): OutcomeLogEntry {
  const resolved = resolveCompanyAndJob(db, companyRef, jobId);
  const createdAt = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO outcome_log (company_id, job_id, result, note, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(resolved.companyId, resolved.jobId, result, note, createdAt);
  return {
    id: Number(insert.lastInsertRowid),
    company_id: resolved.companyId,
    job_id: resolved.jobId,
    result,
    note,
    created_at: createdAt,
  };
}

