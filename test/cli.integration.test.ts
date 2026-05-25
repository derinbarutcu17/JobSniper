import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/state/db.js";
import { runCli } from "../src/presentation/cli.js";
import { makeTempDir } from "./helpers.js";

function minimalConfig(baseDir: string) {
  fs.writeFileSync(
    path.join(baseDir, "config.json"),
    JSON.stringify({
      search: { maxResultsPerQuery: 1, maxQueriesPerLane: 0, minScoreThreshold: 20, browserFallback: false, priorityCities: ["Berlin"], priorityCountries: ["Germany"], remoteScopes: ["remote", "hybrid"] },
      lanes: {
        design_engineering: {
          label: "Design Engineering", type: "job", enabled: true,
          queries: { tr: [], en: ["Berlin design engineer jobs"] },
          keywords: ["design engineer", "figma", "react"],
          queryTerms: ["design engineer"],
          profileSignals: ["design engineer", "figma"],
          titleFamilies: [{ family: "Design Engineer", terms: ["design engineer"] }],
          mismatchTerms: ["senior", "ml engineer"],
          startupTerms: ["seed"],
          companyTerms: ["startup"],
        },
      },
      sources: { rss: [], atsBoards: [], jobBoards: [] },
      blacklist: { companies: [], keywords: [], titleTerms: [], softPenaltyTerms: [], lanes: { design_engineering: [] } },
      sheets: { spreadsheetId: "", createIfMissing: true, folderId: "", tabs: { jobs: "Jobs", companies: "Companies", contacts: "Contacts", runMetrics: "RunMetrics" } },
    }, null, 2),
  );
}

describe("CLI integration with design_engineering", () => {
  it("onboards profile successfully", async () => {
    const baseDir = makeTempDir();
    minimalConfig(baseDir);
    const result = await runCli(["onboard", "Design engineer using Figma, React, TypeScript in Berlin."], baseDir);
    expect(result).toContain("Profile synced");
    expect(result).toContain("Target seniority");
  });

  it("stats returns structured output", async () => {
    const baseDir = makeTempDir();
    minimalConfig(baseDir);
    fs.mkdirSync(path.join(baseDir, "data"), { recursive: true });
    const result = await runCli(["stats"], baseDir);
    expect(result).toContain("Jobs:");
    expect(result).toContain("Companies:");
  });

  it("status returns pipeline info", async () => {
    const baseDir = makeTempDir();
    minimalConfig(baseDir);
    fs.mkdirSync(path.join(baseDir, "data"), { recursive: true });
    const result = await runCli(["status"], baseDir);
    expect(result).toContain("Pipeline Status");
  });

  it("sources test reports providers", async () => {
    const baseDir = makeTempDir();
    minimalConfig(baseDir);
    const result = await runCli(["sources", "test"], baseDir);
    expect(result).toContain("Search providers");
  });

  it("handles draft, route, pitch for a job in design_engineering lane", async () => {
    const baseDir = makeTempDir();
    minimalConfig(baseDir);
    const { db } = openDatabase(baseDir);
    db.exec(`
      INSERT INTO companies (canonical_key, name, created_at, updated_at)
      VALUES ('company:testco', 'TestCo', datetime('now'), datetime('now'));
      INSERT INTO jobs (
        canonical_key, company_id, company_name, title, lane, recommendation, recommended_route, route_confidence, pitch_theme, pitch_angle, url, created_at, updated_at
      ) VALUES (
        'job:test-1', 1, 'TestCo', 'Design Engineer', 'design_engineering', 'cold_email', 'direct_email_first', 0.8, 'design_engineering', 'Lead with hybrid design and code.', 'https://jobs.example.com/1', datetime('now'), datetime('now')
      );
    `);

    await runCli(["onboard", "Design engineer using Figma, React, TypeScript in Berlin."], baseDir);
    expect(await runCli(["route", "1"], baseDir)).toContain("Recommended route");
    expect(await runCli(["pitch", "1"], baseDir)).toContain("Theme:");
    expect(await runCli(["dossier", "company:testco"], baseDir)).toContain("Best route:");
    expect(await runCli(["draft", "1"], baseDir)).toContain("Hello");
    expect(await runCli(["apply-state", "1", "--status", "applied", "--method", "ats"], baseDir)).toContain("Status: applied");
  });

  it("rejects disabled lanes", async () => {
    const baseDir = makeTempDir();
    fs.writeFileSync(
      path.join(baseDir, "config.json"),
      JSON.stringify({
        lanes: {
          disabled_lane: {
            label: "Disabled", type: "job", enabled: false,
            queries: { en: ["test"], tr: [] }, keywords: ["test"], queryTerms: [], profileSignals: [], titleFamilies: [], mismatchTerms: [], startupTerms: [], companyTerms: [],
          },
        },
        blacklist: { lanes: { disabled_lane: [] } },
      }, null, 2),
    );
    await expect(runCli(["run", "--lane", "disabled_lane"], baseDir)).rejects.toThrow("Invalid lane");
  });
});
