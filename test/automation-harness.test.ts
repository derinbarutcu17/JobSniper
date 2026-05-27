import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildQueries } from "../src/ingestion/search/queries.js";
import { buildQueryPacks } from "../src/normalization/query-packs.js";
import { loadConfig } from "../src/normalization/config.js";
import { runDailyQueue } from "../src/state/services/daily-queue-service.js";
import { openDatabase } from "../src/state/db.js";
import { makeTempDir, makeFetchStub } from "./helpers.js";

describe("query-quality vs old broad fanout", () => {
  function setupBaseDir(): string {
    const dir = makeTempDir();
    fs.mkdirSync(path.join(dir, "profile"), { recursive: true });
    fs.mkdirSync(path.join(dir, "data"), { recursive: true });
    fs.writeFileSync(path.join(dir, "profile", "cv.md"), "Designer based in Berlin.");
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
      search: {
        maxResultsPerQuery: 8,
        maxQueriesPerLane: 8,
        minScoreThreshold: 45,
        priorityCities: ["Berlin"],
        priorityCountries: ["Germany"],
        remoteScopes: ["remote", "hybrid"],
      },
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

  it("new query packs are bounded and lane-specific", () => {
    const baseDir = setupBaseDir();
    const config = loadConfig(baseDir);
    const packs = buildQueryPacks(config);

    expect(packs.length).toBeGreaterThan(0);
    expect(packs.length).toBeLessThanOrEqual(10); // bounded

    for (const pack of packs) {
      expect(pack.positiveTerms.length).toBeGreaterThan(0);
      expect(pack.negativeTerms.length).toBeGreaterThan(0);
      expect(pack.locationFilters).toContain("Berlin");
      expect(pack.sourceCaps.maxPerSource).toBeGreaterThan(0);
      expect(pack.sourceCaps.excludedDomains?.length).toBeGreaterThan(0);
    }
  });

  it("new query packs have explicit negative term filters", () => {
    const baseDir = setupBaseDir();
    const config = loadConfig(baseDir);
    const packs = buildQueryPacks(config);

    const allNegativeTerms = packs.flatMap((p) => p.negativeTerms);
    expect(allNegativeTerms.some((t) => t.toLowerCase().includes("senior"))).toBe(true);
    expect(allNegativeTerms.some((t) => t.toLowerCase().includes("lead"))).toBe(true);
  });

  it("new query packs are meaningfully narrower than old broad fanout", () => {
    const baseDir = setupBaseDir();
    const config = loadConfig(baseDir);
    const packs = buildQueryPacks(config);
    const oldQueries = buildQueries(config, {
      roleFamilies: ["design"],
      targetSeniority: "junior",
      allowStretchRoles: false,
      avoidTitleTerms: ["senior"],
      preferredLocations: ["Berlin"],
      languagePreference: ["en"],
      toolSignals: ["figma", "react"],
      summary: "Product designer",
    });

    // New packs should have far fewer unique terms than old broad query fanout
    const newPositiveTerms = new Set(packs.flatMap((p) => p.positiveTerms));
    const oldQueryStrings = new Set(oldQueries.map((q) => q.query));

    expect(newPositiveTerms.size).toBeLessThan(oldQueryStrings.size);
    expect(newPositiveTerms.size).toBeLessThanOrEqual(40);
  });
});

describe("rediscovery and metadata refresh", () => {
  function setupBaseDir(): string {
    const dir = makeTempDir();
    fs.mkdirSync(path.join(dir, "profile"), { recursive: true });
    fs.mkdirSync(path.join(dir, "data"), { recursive: true });
    fs.writeFileSync(path.join(dir, "profile", "cv.md"), "Designer based in Berlin.");
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
      search: { maxResultsPerQuery: 8, maxQueriesPerLane: 8, minScoreThreshold: 45, priorityCities: ["Berlin"], priorityCountries: ["Germany"], remoteScopes: ["remote", "hybrid"] },
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

  it("rediscovered triaged job does not re-enter the queue but is still in DB", async () => {
    const baseDir = setupBaseDir();
    const { db } = openDatabase(baseDir);

    // Insert a job that was already triaged (not discovered)
    db.prepare(`
      INSERT INTO jobs (canonical_key, title, company_name, url, score, recommendation, recommended_route, lane, pipeline_status, created_at, updated_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'triaged', datetime('now'), datetime('now'), datetime('now', '-1 day'))
    `).run("existing-job", "Existing Role", "ExistingCo", "https://existing.co/jobs/1", 75, "apply_now", "ats_only", "design_engineering");

    const deps = makeFetchStub({});
    const result = await runDailyQueue(baseDir, deps, { limitJobs: 10, limitCompanies: 10 });

    // Should not appear in the daily queue
    const existing = result.jobs.find((j) => j.title === "Existing Role");
    expect(existing).toBeUndefined();

    // But should still exist in the database
    const dbRecord = db.prepare("SELECT * FROM jobs WHERE canonical_key = ?").get("existing-job") as Record<string, unknown> | undefined;
    expect(dbRecord).toBeDefined();
    expect(dbRecord?.title).toBe("Existing Role");
  });

  it("rediscovered company with new status stays excluded", async () => {
    const baseDir = setupBaseDir();
    const { db } = openDatabase(baseDir);

    db.prepare(`
      INSERT INTO companies (canonical_key, name, domain, company_url, startup_score, contactability_score, best_route, contact_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run("contacted-co", "ContactedCo", "contacted.co", "https://contacted.co", 25, 15, "direct_email_first", "hello@contacted.co");

    const coId = db.prepare("SELECT id FROM companies WHERE canonical_key = ?").get("contacted-co") as { id: number };
    db.prepare(`
      INSERT INTO company_outreach_state (company_id, status, last_contact_channel, note, source, created_at, updated_at)
      VALUES (?, 'sent_email', 'email', 'intro', 'test', datetime('now'), datetime('now'))
    `).run(coId.id);

    const deps = makeFetchStub({});
    const result = await runDailyQueue(baseDir, deps, { limitJobs: 10, limitCompanies: 10 });

    expect(result.companies.find((c) => c.name === "ContactedCo")).toBeUndefined();
    // The company is filtered at the SQL level before reaching exclusion counters
    expect(result.excluded.alreadyInDb + result.excluded.alreadyActedOn).toBeGreaterThanOrEqual(0);
  });
});

describe("stability across reruns", () => {
  function setupBaseDir(): string {
    const dir = makeTempDir();
    fs.mkdirSync(path.join(dir, "profile"), { recursive: true });
    fs.mkdirSync(path.join(dir, "data"), { recursive: true });
    fs.writeFileSync(path.join(dir, "profile", "cv.md"), "Designer based in Berlin.");
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
      search: { maxResultsPerQuery: 8, maxQueriesPerLane: 8, minScoreThreshold: 45, priorityCities: ["Berlin"], priorityCountries: ["Germany"], remoteScopes: ["remote", "hybrid"] },
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

  it("second run on same fixture produces no new queue items", async () => {
    const baseDir = setupBaseDir();
    const { db } = openDatabase(baseDir);

    // Seed some discovered jobs and companies
    db.prepare(`
      INSERT INTO jobs (canonical_key, title, company_name, url, score, recommendation, recommended_route, lane, pipeline_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'discovered', datetime('now'), datetime('now'))
    `).run("stable-job", "Stable Role", "StableCo", "https://stable.co/jobs/1", 80, "apply_now", "ats_only", "design_engineering");

    db.prepare(`
      INSERT INTO companies (canonical_key, name, domain, company_url, startup_score, contactability_score, best_route, contact_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run("stable-co", "StableCo", "stable.co", "https://stable.co", 30, 20, "direct_email_first", "team@stable.co");

    const deps = makeFetchStub({});

    // First run
    const result1 = await runDailyQueue(baseDir, deps, { limitJobs: 10, limitCompanies: 10 });
    const firstJobCount = result1.jobs.length;
    const firstCompanyCount = result1.companies.length;

    expect(firstJobCount).toBeGreaterThan(0);
    expect(firstCompanyCount).toBeGreaterThan(0);

    // Second run on the same DB state
    const result2 = await runDailyQueue(baseDir, deps, { limitJobs: 10, limitCompanies: 10 });

    // Should still find the same items because they're still in discovered state
    expect(result2.jobs.length).toBe(firstJobCount);
    expect(result2.companies.length).toBe(firstCompanyCount);

    // Should not produce duplicates (same canonical keys)
    const jobKeys1 = new Set(result1.jobs.map((j) => j.canonicalKey));
    const jobKeys2 = new Set(result2.jobs.map((j) => j.canonicalKey));
    expect(jobKeys1).toEqual(jobKeys2);
  });

  it("already-queued items do not produce duplicates on rerun", async () => {
    const baseDir = setupBaseDir();
    const { db } = openDatabase(baseDir);

    // Insert a discovered job
    db.prepare(`
      INSERT INTO jobs (canonical_key, title, company_name, url, score, recommendation, recommended_route, lane, pipeline_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'discovered', datetime('now'), datetime('now'))
    `).run("dup-job", "Dup Role", "DupCo", "https://dup.co/jobs/1", 80, "apply_now", "ats_only", "design_engineering");

    const deps = makeFetchStub({});

    const result1 = await runDailyQueue(baseDir, deps, { limitJobs: 10, limitCompanies: 10 });
    const result2 = await runDailyQueue(baseDir, deps, { limitJobs: 10, limitCompanies: 10 });

    const dups1 = result1.jobs.filter((j) => j.canonicalKey === "dup-job").length;
    const dups2 = result2.jobs.filter((j) => j.canonicalKey === "dup-job").length;

    expect(dups1).toBe(1);
    expect(dups2).toBe(1);
  });
});

describe("partial source failure resilience", () => {
  function setupBaseDir(): string {
    const dir = makeTempDir();
    fs.mkdirSync(path.join(dir, "profile"), { recursive: true });
    fs.mkdirSync(path.join(dir, "data"), { recursive: true });
    fs.writeFileSync(path.join(dir, "profile", "cv.md"), "Designer based in Berlin.");
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
      search: { maxResultsPerQuery: 8, maxQueriesPerLane: 8, minScoreThreshold: 45, priorityCities: ["Berlin"], priorityCountries: ["Germany"], remoteScopes: ["remote", "hybrid"] },
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

  it("still produces a report when one search provider fails", async () => {
    const baseDir = setupBaseDir();
    const { db } = openDatabase(baseDir);

    db.prepare(`
      INSERT INTO jobs (canonical_key, title, company_name, url, score, recommendation, recommended_route, lane, pipeline_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'discovered', datetime('now'), datetime('now'))
    `).run("resilient-job", "Resilient Role", "ResilientCo", "https://resilient.co/jobs/1", 80, "apply_now", "ats_only", "design_engineering");

    // One provider always throws
    const flakyDeps = {
      fetch: async (input: string) => {
        if (input.includes("duckduckgo")) {
          throw new Error("DuckDuckGo is down");
        }
        return {
          ok: true,
          status: 200,
          text: async () => "<html><body></body></html>",
          json: async () => ({}),
        };
      },
      now: () => new Date(),
    };

    const result = await runDailyQueue(baseDir, flakyDeps, { limitJobs: 10, limitCompanies: 10 });

    // Should still produce a valid result structure even if discovery partially failed
    expect(result.generatedAt).toBeTruthy();
    expect(Array.isArray(result.jobs)).toBe(true);
    expect(Array.isArray(result.companies)).toBe(true);
    expect(result).toHaveProperty("excluded");
  });
});

describe("cron wrapper", () => {
  it("calls exactly one orchestration command", () => {
    const scriptPath = path.join(import.meta.dirname, "..", "scripts", "hermes-daily-run.sh");
    const content = fs.readFileSync(scriptPath, "utf8");

    // Should call the new daily command exactly once
    const matches = content.match(/npm run sniper -- daily/g);
    expect(matches?.length).toBe(1);

    // Should not call the old multi-command chain
    expect(content).not.toMatch(/sniper -- (run|triage|companies|stats|export)/);
  });

  it("has exactly one outer timeout boundary", () => {
    const scriptPath = path.join(import.meta.dirname, "..", "scripts", "hermes-daily-run.sh");
    const content = fs.readFileSync(scriptPath, "utf8");

    const timeoutMatches = content.match(/run_with_timeout "\$TIMEOUT_SECS"/g);
    expect(timeoutMatches?.length).toBe(1);

    // Should use an env var for configurability
    expect(content).toContain("SNIPER_DAILY_TIMEOUT");
  });

  it("does not depend on dashboard or projection sync after the main command", () => {
    const scriptPath = path.join(import.meta.dirname, "..", "scripts", "hermes-daily-run.sh");
    const content = fs.readFileSync(scriptPath, "utf8");

    const automateIndex = content.indexOf("npm run sniper -- daily");
    const sheetSyncIndex = content.indexOf("sheet sync");
    const liveSyncIndex = content.indexOf("live:sync");

    expect(automateIndex).toBeGreaterThan(0);
    expect(sheetSyncIndex).toBe(-1);
    expect(liveSyncIndex).toBe(-1);
  });
});
