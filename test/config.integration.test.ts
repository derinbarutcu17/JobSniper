import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/normalization/config.js";

describe("real config integration", () => {
  const config = loadConfig(process.cwd());

  it("loads the design_engineering lane with correct identity", () => {
    const lane = config.lanes.design_engineering;
    expect(lane).toBeDefined();
    expect(lane.label).toBe("Design Engineering");
    expect(lane.type).toBe("job");
    expect(lane.enabled).toBe(true);
  });

  it("design_engineering has all 7 title families", () => {
    const lane = config.lanes.design_engineering;
    const families = lane.titleFamilies!.map((f) => f.family);
    expect(families).toContain("Design Engineer");
    expect(families).toContain("Creative Technologist");
    expect(families).toContain("Product Designer");
    expect(families).toContain("UI/UX Designer");
    expect(families).toContain("UX Engineer");
    expect(families).toContain("AI Product Builder");
    expect(families).toContain("Frontend Engineer");
  });

  it("design_engineering does NOT include AI Engineer or ML Engineer families", () => {
    const lane = config.lanes.design_engineering;
    const families = lane.titleFamilies!.map((f) => f.family);
    expect(families).not.toContain("AI Engineer");
    expect(families).not.toContain("ML Engineer");
  });

  it("design_engineering mismatch terms exclude senior/manager/ml/backend", () => {
    const mismatches = config.lanes.design_engineering.mismatchTerms;
    expect(mismatches).toContain("senior");
    expect(mismatches).toContain("lead");
    expect(mismatches).toContain("manager");
    expect(mismatches).toContain("ml engineer");
    expect(mismatches).toContain("machine learning");
    expect(mismatches).toContain("backend engineer");
    expect(mismatches).not.toContain("frontend");
  });

  it("design_engineering has English queries targeted at Berlin", () => {
    const queries = config.lanes.design_engineering.queries.en;
    expect(queries.length).toBeGreaterThanOrEqual(8);
    expect(queries.every((q) => /berlin/i.test(q))).toBe(true);
  });

  it("company_watch lane exists and is enabled", () => {
    const lane = config.lanes.company_watch;
    expect(lane).toBeDefined();
    expect(lane.type).toBe("company_watch");
    expect(lane.enabled).toBe(true);
  });

  it("blacklist includes design_engineering and company_watch", () => {
    const blacklistLanes = Object.keys(config.blacklist.lanes);
    expect(blacklistLanes).toContain("design_engineering");
    expect(blacklistLanes).toContain("company_watch");
  });

  it("all job board sources target design_engineering or company_watch", () => {
    const validLanes = new Set(["design_engineering", "company_watch"]);
    for (const board of config.sources.jobBoards) {
      expect(validLanes.has(board.lane)).toBe(true);
    }
    for (const board of config.sources.atsBoards) {
      expect(validLanes.has(board.lane!)).toBe(true);
    }
  });

  it("no sources target old lanes (design_jobs, ai_coding_jobs, student_jobs)", () => {
    const oldLanes = ["design_jobs", "ai_coding_jobs", "student_jobs"];
    for (const board of config.sources.jobBoards) {
      expect(oldLanes).not.toContain(board.lane);
    }
    for (const board of config.sources.atsBoards) {
      expect(oldLanes).not.toContain(board.lane!);
    }
  });

  it("default built-in lanes still exist from role-packs.ts despite overrides", () => {
    expect(config.lanes.design_jobs).toBeDefined();
    expect(config.lanes.ai_coding_jobs).toBeDefined();
    expect(config.lanes.student_jobs).toBeDefined();
  });

  it("Wellfound sources are deduplicated (only one Wellfound per lane)", () => {
    const wellfound = config.sources.atsBoards.filter((b) => b.provider === "wellfound");
    const lanes = wellfound.map((b) => b.lane);
    expect(new Set(lanes).size).toBe(lanes.length);
  });
});
