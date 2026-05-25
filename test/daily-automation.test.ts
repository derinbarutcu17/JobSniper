import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/presentation/app.js";
import { openDatabase } from "../src/state/db.js";
import { makeTempDir, makeFetchStub } from "./helpers.js";

describe("automate daily CLI", () => {
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

  it("runs automate daily and returns a summary", async () => {
    const baseDir = setupBaseDir();
    const deps = makeFetchStub({});
    const app = createApp(baseDir, { deps });
    const output = await app.automateDaily();

    expect(output).toContain("Daily queue complete");
    expect(output).toContain("Jobs:");
    expect(output).toContain("Companies:");
    expect(output).toContain("Excluded:");
    expect(output).toContain("Artifacts:");
    expect(output).toContain("JSON:");
    expect(output).toContain("Markdown:");

    const reportDir = path.join(baseDir, "data", "reports");
    const files = fs.readdirSync(reportDir);
    expect(files.some((f) => f.endsWith("-daily-queue.json"))).toBe(true);
    expect(files.some((f) => f.endsWith("-daily-queue.md"))).toBe(true);
  });

  it("respects --limit-jobs and --limit-companies flags", async () => {
    const baseDir = setupBaseDir();
    const { db } = openDatabase(baseDir);

    // Seed some jobs
    for (let i = 0; i < 5; i++) {
      db.prepare(`
        INSERT INTO jobs (canonical_key, title, company_name, url, score, recommendation, recommended_route, lane, pipeline_status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'discovered', datetime('now'), datetime('now'))
      `).run(`job-${i}`, `Job ${i}`, `Co${i}`, `https://co${i}.com`, 70 + i, "apply_now", "ats_only", "design_engineering");
    }

    const deps = makeFetchStub({});
    const app = createApp(baseDir, { deps });
    const output = await app.automateDaily({ limitJobs: 2, limitCompanies: 1 });
    expect(output).toContain("Daily queue complete");
  });

  it("writes valid JSON artifact", async () => {
    const baseDir = setupBaseDir();
    const deps = makeFetchStub({});
    const app = createApp(baseDir, { deps });
    await app.automateDaily();

    const reportDir = path.join(baseDir, "data", "reports");
    const jsonFile = fs.readdirSync(reportDir).find((f) => f.endsWith("-daily-queue.json"));
    expect(jsonFile).toBeDefined();

    const content = fs.readFileSync(path.join(reportDir, jsonFile!), "utf8");
    const parsed = JSON.parse(content);
    expect(parsed).toHaveProperty("jobs");
    expect(parsed).toHaveProperty("companies");
    expect(parsed).toHaveProperty("excluded");
    expect(parsed).toHaveProperty("generatedAt");
    expect(parsed).toHaveProperty("queryPackSummary");
  });

  it("writes a markdown digest with expected sections", async () => {
    const baseDir = setupBaseDir();
    const deps = makeFetchStub({});
    const app = createApp(baseDir, { deps });
    await app.automateDaily();

    const reportDir = path.join(baseDir, "data", "reports");
    const mdFile = fs.readdirSync(reportDir).find((f) => f.endsWith("-daily-queue.md"));
    expect(mdFile).toBeDefined();

    const content = fs.readFileSync(path.join(reportDir, mdFile!), "utf8");
    expect(content).toContain("# Daily Job Sniper Queue");
    expect(content).toContain("## Jobs to Review / Apply");
    expect(content).toContain("## Companies to Cold Email");
    expect(content).toContain("## Exclusion Summary");
    expect(content).toContain("## Query Pack Performance");
    expect(content).toContain("Review-first");
  });
});

describe("hermes-daily-run wrapper", () => {
  it("script exists and calls a single sniper command", () => {
    const scriptPath = path.join(import.meta.dirname, "..", "scripts", "hermes-daily-run.sh");
    expect(fs.existsSync(scriptPath)).toBe(true);

    const content = fs.readFileSync(scriptPath, "utf8");
    // Should call automate daily, not a chain of separate commands
    expect(content).toContain("automate daily");
    // Should not contain the old multi-command chain
    expect(content).not.toContain("sheet pull");
    expect(content).not.toContain("triage 25");
    expect(content).not.toContain("companies 25");
    expect(content).not.toContain("export json");
    // Should have a single timeout helper
    expect(content).toContain("run_with_timeout");
    expect(content).toContain("SNIPER_DAILY_TIMEOUT");
  });
});
