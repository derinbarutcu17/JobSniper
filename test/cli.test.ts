import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { runCli } from "../src/cli.js";
import { makeTempDir } from "./helpers.js";

describe("cli", () => {
  it("supports onboard and digest smoke flow", async () => {
    const baseDir = makeTempDir();
    const onboard = await runCli(
      ["onboard", "I build AI tools and design systems in Berlin using Figma, TypeScript, and Python."],
      baseDir,
    );
    expect(onboard).toContain("Profile synced");
    expect(onboard).toContain("Target seniority");

    fs.mkdirSync(path.join(baseDir, "data"), { recursive: true });
    const digest = await runCli(["digest"], baseDir);
    expect(digest).toContain("No ranked jobs yet");
  });

  it("supports stats and sources smoke commands", async () => {
    const baseDir = makeTempDir();
    expect(await runCli(["sources", "test"], baseDir)).toContain("Search providers");
    expect(await runCli(["stats"], baseDir)).toContain("Jobs:");
  });

  it("executes through the shell wrapper and prints help", () => {
    const result = spawnSync("node", ["./scripts/run-sniper.mjs", "help"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("sniper <subcommand>");
  });

  it("fails through the shell wrapper for unknown commands", () => {
    const result = spawnSync("node", ["./scripts/run-sniper.mjs", "nonsense"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown command: nonsense");
  });

  it("rejects invalid draft ids", async () => {
    const baseDir = makeTempDir();
    await expect(runCli(["draft", "nope"], baseDir)).rejects.toThrow("draft requires a numeric job ID");
  });

  it("rejects disabled lanes from the CLI", async () => {
    const baseDir = makeTempDir();
    fs.writeFileSync(
      path.join(baseDir, "config.json"),
      JSON.stringify(
        {
          lanes: {
            disabled_jobs: {
              label: "Disabled",
              type: "job",
              enabled: false,
              queries: { en: ["disabled"], tr: [] },
              keywords: ["disabled"],
            },
          },
        },
        null,
        2,
      ),
    );

    await expect(runCli(["run", "--lane", "disabled_jobs"], baseDir)).rejects.toThrow("Invalid lane: disabled_jobs");
  });

  it("supports v2 triage and experiments flows", async () => {
    const baseDir = makeTempDir();
    const { db } = openDatabase(baseDir);
    db.exec(`
      INSERT INTO companies (
        canonical_key, name, created_at, updated_at
      ) VALUES (
        'company:north', 'North', datetime('now'), datetime('now')
      );
      INSERT INTO jobs (
        canonical_key, company_id, company_name, title, recommendation, recommended_route, route_confidence, pitch_theme, pitch_angle, url, created_at, updated_at
      ) VALUES (
        'job:north-1', 1, 'North', 'Design Engineer', 'cold_email', 'direct_email_first', 0.8, 'design_engineering', 'Lead with hybrid design and code.', 'https://jobs.example.com/north', datetime('now'), datetime('now')
      );
    `);

    expect(await runCli(["triage"], baseDir)).toContain("cold_email");
    expect(await runCli(["route", "1"], baseDir)).toContain("Recommended route");
    expect(await runCli(["pitch", "1"], baseDir)).toContain("Theme:");
    expect(await runCli(["dossier", "company:north"], baseDir)).toContain("Best route:");
    expect(await runCli(["pipeline", "1"], baseDir)).toContain("Pipeline updated job");
    expect(await runCli(["assets", "1"], baseDir)).toContain("Assets:");
    expect(await runCli(["apply-state", "1", "--status", "applied", "--method", "ats"], baseDir)).toContain("Status: applied");
    expect(await runCli(["company-state", "company:north", "--status", "sent_email", "--channel", "email", "--job", "1"], baseDir)).toContain("applied");
    expect(await runCli(["contact", "log", "company:north", "--channel", "email"], baseDir)).toContain("Logged contact attempt");
    expect(await runCli(["outcome", "log", "company:north", "--result", "reply"], baseDir)).toContain("Logged outcome");
    expect(await runCli(["experiments"], baseDir)).toContain("Route performance:");
  });

  it("keeps sheet pull opt-in only", async () => {
    const baseDir = makeTempDir();
    await expect(runCli(["sheet", "pull"], baseDir)).rejects.toThrow("sheet pull is disabled by default");
  });
});
