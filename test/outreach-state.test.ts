import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase, updateJobPipelineFields, upsertApplication } from "../src/db.js";
import { buildCompanyOutreachSnapshots } from "../src/outreach-state.js";
import { createOutreachStatusService } from "../src/services/outreach-status-service.js";
import { generateDashboardData } from "../scripts/export-dashboard-data.js";
import { makeTempDir } from "./helpers.js";

describe("outreach state", () => {
  it("tracks company-level reached and sent email without needing a fake job row", () => {
    const baseDir = makeTempDir();
    const { db } = openDatabase(baseDir);
    db.exec(`
      INSERT INTO companies (canonical_key, name, created_at, updated_at)
      VALUES ('company:north', 'North', datetime('now'), datetime('now'));
    `);

    const service = createOutreachStatusService(baseDir);
    const reached = service.setCompanyState({ companyRef: "company:north", status: "reached", note: "company identified" });
    expect(reached.status).toBe("reached");

    const sent = service.setCompanyState({ companyRef: "company:north", status: "sent_email", channel: "email", note: "intro sent" });
    expect(sent.status).toBe("sent_email");
    expect(sent.lastContactChannel).toBe("email");

    const snapshots = buildCompanyOutreachSnapshots(db);
    expect(snapshots[0]?.status).toBe("sent_email");
  });

  it("applies precedence so talking and rejected beat earlier states", () => {
    const baseDir = makeTempDir();
    const { db } = openDatabase(baseDir);
    db.exec(`
      INSERT INTO companies (canonical_key, name, created_at, updated_at)
      VALUES ('company:north', 'North', datetime('now'), datetime('now'));
      INSERT INTO jobs (
        canonical_key, company_id, company_name, title, url, created_at, updated_at
      ) VALUES (
        'job:north-1', 1, 'North', 'Design Engineer', 'https://jobs.example.com/north', datetime('now'), datetime('now')
      );
    `);

    updateJobPipelineFields(db, 1, { pipelineStatus: "applied", appliedAt: "2026-04-27T10:00:00Z", applicationMethod: "ats" });
    upsertApplication(db, {
      jobId: 1,
      companyId: 1,
      status: "applied",
      method: "ats",
      submittedAt: "2026-04-27T10:00:00Z",
      source: "test",
    });

    const service = createOutreachStatusService(baseDir);
    expect(buildCompanyOutreachSnapshots(db)[0]?.status).toBe("applied");

    service.setCompanyState({ companyRef: "company:north", status: "talking", jobId: 1, note: "recruiter replied" });
    expect(buildCompanyOutreachSnapshots(db)[0]?.status).toBe("talking");

    service.setCompanyState({ companyRef: "company:north", status: "rejected", jobId: 1, note: "closed out" });
    expect(buildCompanyOutreachSnapshots(db)[0]?.status).toBe("rejected");
  });

  it("exports dashboard and outreach artifact directly from db state", () => {
    const baseDir = makeTempDir();
    const { db } = openDatabase(baseDir);
    db.exec(`
      INSERT INTO companies (canonical_key, name, created_at, updated_at)
      VALUES ('company:north', 'North', datetime('now'), datetime('now'));
    `);
    const service = createOutreachStatusService(baseDir);
    service.setCompanyState({ companyRef: "company:north", status: "sent_email", channel: "email", note: "intro sent" });

    generateDashboardData(baseDir);

    const dashboard = JSON.parse(fs.readFileSync(path.join(baseDir, "dashboard", "data", "dashboard.json"), "utf8")) as {
      summary: Record<string, number>;
      companyOutreach: Array<{ status: string; companyName: string }>;
    };
    const outreachStatus = JSON.parse(fs.readFileSync(path.join(baseDir, "dashboard", "data", "outreach-status.json"), "utf8")) as Array<{
      status: string;
      companyName: string;
    }>;
    const outreachMarkdown = fs.readFileSync(path.join(baseDir, "dashboard", "data", "outreach-status.md"), "utf8");

    expect(dashboard.summary.sentEmails).toBe(1);
    expect(dashboard.companyOutreach[0]?.status).toBe("sent_email");
    expect(outreachStatus[0]?.companyName).toBe("North");
    expect(outreachMarkdown).toContain("## Sent Email");
    expect(outreachMarkdown).toContain("North");
  });
});
