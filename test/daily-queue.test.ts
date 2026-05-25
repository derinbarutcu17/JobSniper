import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runDailyQueue } from "../src/state/services/daily-queue-service.js";
import { openDatabase } from "../src/state/db.js";
import { makeTempDir, makeFetchStub } from "./helpers.js";

describe("daily-queue", () => {
  function setupFixtureDb(baseDir: string) {
    const { db } = openDatabase(baseDir);

    // Insert a company that is already contacted
    db.prepare(`
      INSERT INTO companies (canonical_key, name, domain, company_url, startup_score, contactability_score, best_route, contact_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run("synthflow-ai", "Synthflow AI", "synthflow.ai", "https://synthflow.ai", 20, 15, "direct_email_first", "hello@synthflow.ai");

    const synthflowId = db.prepare("SELECT id FROM companies WHERE canonical_key = ?").get("synthflow-ai") as { id: number };
    db.prepare(`
      INSERT INTO company_outreach_state (company_id, status, last_contact_channel, note, source, created_at, updated_at)
      VALUES (?, 'sent_email', 'email', 'intro sent', 'test', datetime('now'), datetime('now'))
    `).run(synthflowId.id);

    // Insert a company that is new
    db.prepare(`
      INSERT INTO companies (canonical_key, name, domain, company_url, startup_score, contactability_score, best_route, contact_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run("fresh-startup", "Fresh Startup", "fresh.io", "https://fresh.io", 25, 12, "direct_email_first", "team@fresh.io");

    // Insert a job that is already applied
    db.prepare(`
      INSERT INTO jobs (canonical_key, title, company_name, url, score, recommendation, recommended_route, lane, pipeline_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'applied', datetime('now'), datetime('now'))
    `).run("old-job", "Old Role", "OldCo", "https://old.co/jobs/1", 80, "apply_now", "ats_only", "design_engineering");

    // Insert a fresh job
    db.prepare(`
      INSERT INTO jobs (canonical_key, title, company_name, url, score, recommendation, recommended_route, lane, pipeline_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'discovered', datetime('now'), datetime('now'))
    `).run("new-job", "New Role", "NewCo", "https://new.co/jobs/1", 75, "apply_now", "ats_only", "design_engineering");

    return db;
  }

  function setupBaseDir(): string {
    const dir = makeTempDir();
    fs.mkdirSync(path.join(dir, "profile"), { recursive: true });
    fs.mkdirSync(path.join(dir, "data"), { recursive: true });
    fs.writeFileSync(path.join(dir, "profile", "cv.md"), "Designer and developer based in Berlin.");
    fs.writeFileSync(path.join(dir, "profile", "profile.json"), JSON.stringify({
      roleFamilies: ["design"],
      targetSeniority: "junior",
      allowStretchRoles: false,
      avoidTitleTerms: ["senior"],
      preferredLocations: ["Berlin"],
      languagePreference: ["en"],
      toolSignals: ["figma", "react"],
      summary: "Product designer",
    }));

    fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify({
      lanes: {
        design_engineering: {
          label: "Design Engineering",
          type: "job",
          enabled: true,
          queries: { tr: [], en: ["Berlin design engineer jobs"] },
          keywords: ["design engineer", "react"],
          queryTerms: ["design engineer", "product designer"],
          profileSignals: ["figma", "react"],
          titleFamilies: [{ family: "Design Engineer", terms: ["design engineer"] }],
          mismatchTerms: ["senior"],
          startupTerms: ["seed"],
          companyTerms: ["startup", "studio"],
        },
      },
    }));
    fs.writeFileSync(path.join(dir, "config.lanes.json"), JSON.stringify({
      design_engineering: {
        label: "Design Engineering",
        type: "job",
        enabled: true,
        queries: { tr: [], en: ["Berlin design engineer jobs"] },
        keywords: ["design engineer", "react"],
        queryTerms: ["design engineer", "product designer"],
        profileSignals: ["figma", "react"],
        titleFamilies: [{ family: "Design Engineer", terms: ["design engineer"] }],
        mismatchTerms: ["senior"],
        startupTerms: ["seed"],
        companyTerms: ["startup", "studio"],
      },
    }));
    fs.writeFileSync(path.join(dir, "config.sources.json"), JSON.stringify({ rss: [], atsBoards: [], jobBoards: [] }));
    fs.writeFileSync(path.join(dir, "config.tomorrow.json"), JSON.stringify({ ashbyQueries: [], searchQueries: [], curatedCompanies: [] }));

    return dir;
  }

  it("excludes already-acted-on companies and jobs from the queue", async () => {
    const baseDir = setupBaseDir();
    setupFixtureDb(baseDir);

    const deps = makeFetchStub({});
    const result = await runDailyQueue(baseDir, deps, { limitJobs: 10, limitCompanies: 10 });

    // Synthflow AI should be excluded because it has outreach state
    const synthflow = result.companies.find((c) => c.name === "Synthflow AI");
    expect(synthflow).toBeUndefined();

    // Old Role should be excluded because pipeline_status is applied
    const oldJob = result.jobs.find((j) => j.title === "Old Role");
    expect(oldJob).toBeUndefined();

    // New Role should appear
    const newJob = result.jobs.find((j) => j.title === "New Role");
    expect(newJob).toBeDefined();

    expect(result.excluded.alreadyInDb + result.excluded.alreadyActedOn).toBeGreaterThan(0);
  });

  it("respects human exclusions from source-of-truth", async () => {
    const baseDir = setupBaseDir();
    setupFixtureDb(baseDir);

    // Write a human exclusion file
    const workspaceRoot = path.resolve(baseDir, "..");
    const memoryDir = path.join(workspaceRoot, "memory");
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(
      path.join(memoryDir, "job-search-source-of-truth.md"),
      "## Already Applied / Contacted\n\n- Fresh Startup\n",
    );

    const deps = makeFetchStub({});
    const result = await runDailyQueue(baseDir, deps, { limitJobs: 10, limitCompanies: 10 });

    const fresh = result.companies.find((c) => c.name === "Fresh Startup");
    expect(fresh).toBeUndefined();
  });

  it("does not falsely deduplicate jobs with different canonical keys", async () => {
    const baseDir = setupBaseDir();
    const db = setupFixtureDb(baseDir);

    // Insert two jobs for the same company but with different canonical keys
    db.prepare(`
      INSERT INTO jobs (canonical_key, title, company_name, url, score, recommendation, recommended_route, lane, pipeline_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'discovered', datetime('now'), datetime('now'))
    `).run("dupco-a", "Dup A", "DupCo", "https://dup.co/a", 70, "apply_now", "ats_only", "design_engineering");
    db.prepare(`
      INSERT INTO jobs (canonical_key, title, company_name, url, score, recommendation, recommended_route, lane, pipeline_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'discovered', datetime('now'), datetime('now'))
    `).run("dupco-b", "Dup B", "DupCo", "https://dup.co/b", 65, "cold_email", "direct_email_first", "design_engineering");

    const deps = makeFetchStub({});
    const result = await runDailyQueue(baseDir, deps, { limitJobs: 10, limitCompanies: 10 });

    // Both should appear because they have different canonical keys
    const dups = result.jobs.filter((j) => j.companyName === "DupCo");
    expect(dups.length).toBe(2);
  });

  it("sorts jobs by recommendation priority then score", async () => {
    const baseDir = setupBaseDir();
    const db = setupFixtureDb(baseDir);

    db.prepare(`
      INSERT INTO jobs (canonical_key, title, company_name, url, score, recommendation, recommended_route, lane, pipeline_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'discovered', datetime('now'), datetime('now'))
    `).run("watch-job", "Watch Role", "WatchCo", "https://watch.co", 90, "watch", "watch_company", "design_engineering");
    db.prepare(`
      INSERT INTO jobs (canonical_key, title, company_name, url, score, recommendation, recommended_route, lane, pipeline_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'discovered', datetime('now'), datetime('now'))
    `).run("cold-job", "Cold Role", "ColdCo", "https://cold.co", 60, "cold_email", "direct_email_first", "design_engineering");

    const deps = makeFetchStub({});
    const result = await runDailyQueue(baseDir, deps, { limitJobs: 10, limitCompanies: 10 });

    const recs = result.jobs.map((j) => j.recommendation);
    expect(recs).toContain("apply_now");
    expect(recs).toContain("cold_email");
    expect(recs).toContain("watch");

    const applyIdx = recs.indexOf("apply_now");
    const coldIdx = recs.indexOf("cold_email");
    const watchIdx = recs.indexOf("watch");

    expect(applyIdx).toBeLessThan(coldIdx);
    expect(coldIdx).toBeLessThan(watchIdx);
  });

  it("returns structured result with metadata", async () => {
    const baseDir = setupBaseDir();
    setupFixtureDb(baseDir);

    const deps = makeFetchStub({});
    const result = await runDailyQueue(baseDir, deps, { limitJobs: 5, limitCompanies: 5 });

    expect(result.generatedAt).toBeTruthy();
    expect(Array.isArray(result.jobs)).toBe(true);
    expect(Array.isArray(result.companies)).toBe(true);
    expect(result.excluded).toHaveProperty("alreadyInDb");
    expect(result.excluded).toHaveProperty("alreadyActedOn");
    expect(result.excluded).toHaveProperty("humanExcluded");
    expect(result.excluded).toHaveProperty("lowScore");
    expect(result.excluded).toHaveProperty("negativeTermMatch");
    expect(Array.isArray(result.queryPackSummary)).toBe(true);
  });

  it("dry run skips network discovery and still reports from DB state", async () => {
    const baseDir = setupBaseDir();
    const { db } = openDatabase(baseDir);

    db.prepare(`
      INSERT INTO companies (canonical_key, name, domain, company_url, startup_score, contactability_score, best_route, contact_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run("dry-run-startup", "Dry Run Startup", "dryrun.io", "https://dryrun.io", 25, 12, "direct_email_first", "team@dryrun.io");

    db.prepare(`
      INSERT INTO company_outreach_state (company_id, status, last_contact_channel, note, source, created_at, updated_at)
      VALUES ((SELECT id FROM companies WHERE canonical_key = ?), 'new', '', '', 'test', datetime('now'), datetime('now'))
    `).run("dry-run-startup");

    db.prepare(`
      INSERT INTO jobs (canonical_key, title, company_name, url, score, recommendation, recommended_route, lane, pipeline_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'discovered', datetime('now'), datetime('now'))
    `).run("dry-run-job", "Dry Run Role", "Dry Run Startup", "https://dryrun.io/jobs/1", 82, "apply_now", "ats_only", "design_engineering");

    const deps = {
      fetch: async () => {
        throw new Error("dry run should not fetch");
      },
      now: () => new Date(),
    };

    const result = await runDailyQueue(baseDir, deps, { limitJobs: 5, limitCompanies: 5, dryRun: true });

    expect(result.jobs.map((job) => job.title)).toContain("Dry Run Role");
    expect(result.companies.map((company) => company.name)).toContain("Dry Run Startup");
    expect(result.queryPackSummary.every((pack) => pack.queried === 0)).toBe(true);
  });
});
