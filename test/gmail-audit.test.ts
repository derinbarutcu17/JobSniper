import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importGmailAudit } from "../src/daily/gmail-audit.js";
import { openDatabase } from "../src/state/db.js";
import { makeTempDir } from "./helpers.js";

function seedCompany(baseDir: string): number {
  const { db } = openDatabase(baseDir);
  db.prepare(`
    INSERT INTO companies (canonical_key, name, domain, company_url, created_at, updated_at)
    VALUES ('company:testco', 'TestCo', 'testco.com', 'https://testco.com', datetime('now'), datetime('now'))
  `).run();
  db.prepare(`
    INSERT INTO jobs (canonical_key, company_id, company_name, title, url, apply_url, source, created_at, updated_at)
    VALUES ('job:testco-role', 1, 'TestCo', 'Product Designer', 'https://testco.com/jobs/1', 'https://testco.com/jobs/1', 'seed', datetime('now'), datetime('now'))
  `).run();
  return 1;
}

describe("gmail audit import", () => {
  it("marks sent outreach as contacted", () => {
    const baseDir = makeTempDir();
    seedCompany(baseDir);
    fs.mkdirSync(path.join(baseDir, "data", "import"), { recursive: true });
    fs.writeFileSync(
      path.join(baseDir, "data", "import", "gmail-audit.json"),
      JSON.stringify([
        {
          kind: "sent",
          subject: "Hello",
          from: "derin@example.com",
          to: "jobs@testco.com",
          date: "2026-05-25T09:00:00.000Z",
          companyDomain: "testco.com",
          evidenceSummary: "Sent email to jobs@testco.com",
        },
      ]),
    );
    const status = importGmailAudit(baseDir);
    const { db } = openDatabase(baseDir);
    const row = db.prepare("SELECT status FROM company_outreach_state WHERE company_id = 1").get() as { status: string };
    expect(status.contactedMutations).toBe(1);
    expect(row.status).toBe("sent_email");
  });

  it("marks ATS confirmations as applied", () => {
    const baseDir = makeTempDir();
    seedCompany(baseDir);
    fs.mkdirSync(path.join(baseDir, "data", "import"), { recursive: true });
    fs.writeFileSync(
      path.join(baseDir, "data", "import", "gmail-audit.json"),
      JSON.stringify([
        {
          kind: "received",
          subject: "Thank you for applying",
          from: "no-reply@greenhouse.io",
          to: "derin@example.com",
          date: "2026-05-25T09:15:00.000Z",
          companyDomain: "testco.com",
          evidenceSummary: "Application received",
        },
      ]),
    );
    const status = importGmailAudit(baseDir);
    const { db } = openDatabase(baseDir);
    const row = db.prepare("SELECT pipeline_status FROM jobs WHERE id = 1").get() as { pipeline_status: string };
    expect(status.appliedMutations).toBe(1);
    expect(row.pipeline_status).toBe("applied");
  });

  it("ignores newsletters and ambiguous entries", () => {
    const baseDir = makeTempDir();
    seedCompany(baseDir);
    fs.mkdirSync(path.join(baseDir, "data", "import"), { recursive: true });
    fs.writeFileSync(
      path.join(baseDir, "data", "import", "gmail-audit.json"),
      JSON.stringify([
        {
          kind: "received",
          subject: "Weekly newsletter",
          from: "news@testco.com",
          to: "derin@example.com",
          date: "2026-05-25T09:15:00.000Z",
          companyDomain: "testco.com",
          evidenceSummary: "Newsletter",
        },
        {
          kind: "sent",
          subject: "Checking in",
          from: "derin@example.com",
          to: "person@testco.com",
          date: "2026-05-25T09:20:00.000Z",
          companyDomain: "testco.com",
          evidenceSummary: "Ambiguous message",
        },
      ]),
    );
    const status = importGmailAudit(baseDir);
    const { db } = openDatabase(baseDir);
    const row = db.prepare("SELECT COUNT(*) as count FROM company_outreach_state").get() as { count: number };
    expect(status.appliedMutations).toBe(0);
    expect(status.contactedMutations).toBe(0);
    expect(row.count).toBe(0);
    expect(status.warnings.length).toBeGreaterThan(0);
  });
});
