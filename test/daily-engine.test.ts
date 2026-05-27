import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { runDailyEngine } from "../src/daily/daily-engine.js";
import { openDatabase } from "../src/state/db.js";
import type { DailyReportPayload, SheetsSyncStatus } from "../src/daily/daily-types.js";
import { makeTempDir, makeFetchStub } from "./helpers.js";

function seedDailyRows(baseDir: string, companyCount: number, jobCount: number): void {
  const { db } = openDatabase(baseDir);
  for (let index = 1; index <= companyCount; index += 1) {
    db.prepare(`
      INSERT INTO companies (
        canonical_key, name, domain, location, company_url, public_contacts, startup_score, company_fit_score, contactability_score, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      `company:${index}`,
      `Company ${index}`,
      `company${index}.com`,
      "Berlin",
      `https://company${index}.com`,
      JSON.stringify([`hello@company${index}.com`]),
      12,
      10,
      8,
    );
  }

  for (let index = 1; index <= jobCount; index += 1) {
    const companyId = ((index - 1) % companyCount) + 1;
    db.prepare(`
      INSERT INTO jobs (
        canonical_key, company_id, company_name, title, location, language, work_model, description, url, apply_url, source, score, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(
      `job:${index}`,
      companyId,
      `Company ${companyId}`,
      `Product Designer ${index}`,
      "Berlin",
      "English working language",
      "hybrid",
      "Hands-on startup product design role with React, Figma, and design systems.",
      `https://company${companyId}.com/jobs/${index}`,
      `https://company${companyId}.com/jobs/${index}`,
      "seed",
      80,
    );
  }
}

const noopDiscovery = async () => ({
  lanes: ["design_jobs"],
  warnings: ["one optional source failed"],
  sourcesAttempted: ["seed"],
});

const fakeSheetStatus = async (_baseDir: string, _payload: DailyReportPayload): Promise<SheetsSyncStatus> => ({
  skipped: false,
  ok: true,
  message: "synced",
  spreadsheetUrl: "https://docs.google.com/spreadsheets/d/test",
  warnings: [],
});

describe("daily engine", () => {
  it("caps normal mode at 7 jobs and 10 companies and writes artifacts", async () => {
    const baseDir = makeTempDir();
    seedDailyRows(baseDir, 12, 11);
    const result = await runDailyEngine(baseDir, {
      mode: "normal",
      noSheet: true,
      deps: makeFetchStub({
        "https://portfolio.example.com/": { body: "<html><body>Portfolio</body></html>" },
        "https://api.github.com/users/example": { body: JSON.stringify({ bio: "Designer", public_repos: 3, followers: 2 }) },
        "https://api.github.com/users/example/repos?per_page=6&sort=updated": { body: JSON.stringify([{ name: "one", description: "repo", language: "TypeScript" }]) },
      }),
      hooks: {
        runDiscovery: noopDiscovery,
      },
    });
    expect(result.payload.jobs).toHaveLength(7);
    expect(result.payload.companies).toHaveLength(10);
    expect(fs.existsSync(result.payload.reportPath)).toBe(true);
    expect(fs.existsSync(result.payload.jsonPath)).toBe(true);
    expect(result.payload.sheets.skipped).toBe(true);
  });

  it("caps deep mode at 15 jobs and 25 companies", async () => {
    const baseDir = makeTempDir();
    seedDailyRows(baseDir, 30, 20);
    const result = await runDailyEngine(baseDir, {
      mode: "deep",
      noSheet: true,
      deps: makeFetchStub({}),
      hooks: { runDiscovery: noopDiscovery },
    });
    expect(result.payload.jobs).toHaveLength(15);
    expect(result.payload.companies).toHaveLength(25);
  });

  it("auto-triggers deep mode when normal mode finds too little", async () => {
    const baseDir = makeTempDir();
    seedDailyRows(baseDir, 1, 1);
    const result = await runDailyEngine(baseDir, {
      mode: "normal",
      noSheet: true,
      deps: makeFetchStub({}),
      hooks: { runDiscovery: noopDiscovery },
    });
    expect(result.payload.mode).toBe("deep");
    expect(result.payload.summary.autoDeepTriggered).toBe(true);
  });

  it("can sync sheets through the hook without failing the run", async () => {
    const baseDir = makeTempDir();
    seedDailyRows(baseDir, 3, 3);
    const result = await runDailyEngine(baseDir, {
      mode: "normal",
      deps: makeFetchStub({}),
      hooks: {
        runDiscovery: noopDiscovery,
        syncSheets: fakeSheetStatus,
      },
    });
    expect(result.payload.sheets.ok).toBe(true);
  });

  it("survives optional-source warnings", async () => {
    const baseDir = makeTempDir();
    seedDailyRows(baseDir, 3, 3);
    const result = await runDailyEngine(baseDir, {
      mode: "normal",
      noSheet: true,
      deps: makeFetchStub({}),
      hooks: {
        runDiscovery: async () => ({
          lanes: ["design_jobs"],
          warnings: ["optional source failed"],
          sourcesAttempted: ["search", "rss"],
        }),
      },
    });
    expect(result.payload.discovery.warnings).toContain("optional source failed");
    expect(result.payload.jobs.length).toBeGreaterThan(0);
  });

  it("prefers fresher companies when confidence is otherwise tied", async () => {
    const baseDir = makeTempDir();
    seedDailyRows(baseDir, 2, 2);
    const { db } = openDatabase(baseDir);
    db.prepare("UPDATE companies SET updated_at = '2026-01-01T00:00:00.000Z' WHERE name = 'Company 2'").run();

    const result = await runDailyEngine(baseDir, {
      mode: "normal",
      noSheet: true,
      noAutoDeep: true,
      deps: makeFetchStub({}),
      hooks: { runDiscovery: noopDiscovery },
    });

    expect(result.payload.companies[0]?.company).toBe("Company 1");
  });

  it("skips portfolio-only company leads until a stronger Berlin funding source confirms them", async () => {
    const baseDir = makeTempDir();
    seedDailyRows(baseDir, 1, 1);
    const { db } = openDatabase(baseDir);
    db.prepare(`
      UPDATE companies
      SET source_urls = '["https://www.project-a.vc/companies/"]',
          location = 'Berlin'
      WHERE name = 'Company 1'
    `).run();

    const result = await runDailyEngine(baseDir, {
      mode: "normal",
      noSheet: true,
      noAutoDeep: true,
      deps: makeFetchStub({}),
      hooks: { runDiscovery: noopDiscovery },
    });

    expect(result.payload.companies).toHaveLength(0);
    expect(result.payload.skipped.some((item) => item.details.includes("VC portfolio lead still needs Berlin/funding confirmation"))).toBe(true);
  });

  it("skips stale LinkedIn carryover jobs older than 45 days", async () => {
    const baseDir = makeTempDir();
    seedDailyRows(baseDir, 1, 1);
    const { db } = openDatabase(baseDir);
    db.prepare(`
      UPDATE jobs
      SET source = 'LinkedIn Berlin',
          recommendation = 'enrich_first',
          posted_at = '2026-01-01T00:00:00.000Z',
          updated_at = '2026-01-01T00:00:00.000Z'
    `).run();

    const result = await runDailyEngine(baseDir, {
      mode: "normal",
      noSheet: true,
      noAutoDeep: true,
      deps: makeFetchStub({}),
      hooks: { runDiscovery: noopDiscovery },
    });

    expect(result.payload.jobs).toHaveLength(0);
    expect(result.payload.skipped.some((item) => item.details.includes("Stale LinkedIn carryover"))).toBe(true);
  });
});
