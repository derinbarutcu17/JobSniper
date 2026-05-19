import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/normalization/config.js";
import { makeTempDir } from "./helpers.js";

describe("config validation", () => {
  it("includes built-in student lane defaults", () => {
    const config = loadConfig(makeTempDir());
    expect(config.lanes.student_jobs).toBeDefined();
    expect(config.sources.atsBoards.some((board) => board.lane === "student_jobs")).toBe(true);
    expect(config.sources.jobBoards.some((board) => board.lane === "student_jobs")).toBe(true);
    expect(config.blacklist.lanes.student_jobs).toEqual([]);
    expect(config.lanes.student_jobs.queries.en.some((query) => /werkstudent|internship|praktikum/i.test(query))).toBe(true);
  });

  it("targets Berlin startup directories in company watch queries", () => {
    const config = loadConfig(makeTempDir());
    expect(
      config.lanes.company_watch.queries.en.some((query) => /startupberlin|ai\.berlin|startups-list|seedtable|handpickedberlin/i.test(query)),
    ).toBe(true);
    expect(config.lanes.company_watch.companyTerms).toContain("Berlin");
  });

  it("merges config fragments from sidecar files", () => {
    const baseDir = makeTempDir();
    fs.writeFileSync(
      path.join(baseDir, "config.lanes.json"),
      JSON.stringify(
        {
          design_jobs: {
            label: "Design Jobs (Alt)",
            type: "job",
            enabled: true,
            queries: { en: ["Berlin design engineer jobs"], tr: [] },
            keywords: ["design engineer"],
            queryTerms: ["design engineer"],
            profileSignals: ["design"],
            titleFamilies: [{ family: "Design Engineer", terms: ["design engineer"] }],
            mismatchTerms: [],
            startupTerms: [],
            companyTerms: [],
          },
        },
        null,
        2,
      ),
    );

    const config = loadConfig(baseDir);
    expect(config.lanes.design_jobs.label).toBe("Design Jobs (Alt)");
    expect(config.lanes.design_jobs.queries.en).toContain("Berlin design engineer jobs");
  });

  it("rejects enabled lanes with no queries or keywords", () => {
    const baseDir = makeTempDir();
    fs.writeFileSync(
      path.join(baseDir, "config.json"),
      JSON.stringify(
        {
          lanes: {
            empty_lane: {
              label: "Empty",
              type: "job",
              enabled: true,
              queries: { en: [], tr: [] },
              keywords: [],
              queryTerms: [],
              profileSignals: [],
              titleFamilies: [],
              mismatchTerms: [],
              startupTerms: [],
              companyTerms: [],
            },
          },
        },
        null,
        2,
      ),
    );

    expect(() => loadConfig(baseDir)).toThrow('Lane "empty_lane" is enabled but has no queries or keywords.');
  });

  it("rejects ATS boards that reference unknown lanes", () => {
    const baseDir = makeTempDir();
    fs.writeFileSync(
      path.join(baseDir, "config.json"),
      JSON.stringify(
        {
          sources: {
            atsBoards: [
              {
                name: "Ghost Board",
                provider: "greenhouse",
                url: "https://boards.greenhouse.io/ghost",
                lane: "ghost_lane",
              },
            ],
          },
        },
        null,
        2,
      ),
    );

    expect(() => loadConfig(baseDir)).toThrow('ATS source "Ghost Board" references unknown lane "ghost_lane".');
  });

  it("rejects malformed job-board sources", () => {
    const baseDir = makeTempDir();
    fs.writeFileSync(
      path.join(baseDir, "config.json"),
      JSON.stringify(
        {
          sources: {
            jobBoards: [
              {
                name: "Broken Board",
                provider: "monster",
                lane: "design_jobs",
              },
            ],
          },
        },
        null,
        2,
      ),
    );

    expect(() => loadConfig(baseDir)).toThrow('Job-board source "Broken Board" has unsupported provider "monster".');
  });
});
