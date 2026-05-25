import { describe, expect, it } from "vitest";
import { buildQueryPacks, isAllowedDomain, matchesQueryPack } from "../src/normalization/query-packs.js";
import { loadConfig } from "../src/normalization/config.js";
import { makeTempDir } from "./helpers.js";
import fs from "node:fs";
import path from "node:path";

describe("query-packs", () => {
  function setupConfigDir(): string {
    const dir = makeTempDir();
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        lanes: {
          design_engineering: {
            label: "Design Engineering",
            type: "job",
            enabled: true,
            queries: { tr: [], en: ["Berlin design engineer jobs"] },
            keywords: ["design engineer", "react", "typescript"],
            queryTerms: ["design engineer", "product designer"],
            profileSignals: ["figma", "design systems"],
            titleFamilies: [{ family: "Design Engineer", terms: ["design engineer"] }],
            mismatchTerms: ["senior"],
            startupTerms: ["seed", "series a"],
            companyTerms: ["startup", "studio"],
          },
          company_watch: {
            label: "Company Watch",
            type: "company_watch",
            enabled: true,
            queries: { tr: [], en: ["Berlin startups"] },
            keywords: ["startup", "hiring"],
            companyTerms: ["startup", "studio", "builder"],
            startupTerms: ["seed", "series a"],
          },
        },
      }),
    );
    fs.writeFileSync(
      path.join(dir, "config.lanes.json"),
      JSON.stringify({
        design_engineering: {
          label: "Design Engineering",
          type: "job",
          enabled: true,
          queries: { tr: [], en: ["Berlin design engineer jobs"] },
          keywords: ["design engineer", "react", "typescript"],
          queryTerms: ["design engineer", "product designer"],
          profileSignals: ["figma", "design systems"],
          titleFamilies: [{ family: "Design Engineer", terms: ["design engineer"] }],
          mismatchTerms: ["senior"],
          startupTerms: ["seed", "series a"],
          companyTerms: ["startup", "studio"],
        },
        company_watch: {
          label: "Company Watch",
          type: "company_watch",
          enabled: true,
          queries: { tr: [], en: ["Berlin startups"] },
          keywords: ["startup", "hiring"],
          companyTerms: ["startup", "studio", "builder"],
          startupTerms: ["seed", "series a"],
        },
      }),
    );
    fs.writeFileSync(path.join(dir, "config.sources.json"), JSON.stringify({ rss: [], atsBoards: [], jobBoards: [] }));
    fs.writeFileSync(path.join(dir, "config.tomorrow.json"), JSON.stringify({ ashbyQueries: [], searchQueries: [], curatedCompanies: [] }));
    return dir;
  }

  it("builds query packs for enabled lanes", () => {
    const dir = setupConfigDir();
    const config = loadConfig(dir);
    const packs = buildQueryPacks(config);

    expect(packs.length).toBeGreaterThanOrEqual(2);

    const jobPack = packs.find((p) => p.target === "job");
    expect(jobPack).toBeDefined();
    expect(jobPack?.positiveTerms).toContain("design engineer");
    expect(jobPack?.negativeTerms).toContain("senior");
    expect(jobPack?.locationFilters).toContain("Berlin");

    const companyPack = packs.find((p) => p.target === "company");
    expect(companyPack).toBeDefined();
    expect(companyPack?.positiveTerms).toContain("startup");
  });

  it("filters out disabled lanes", () => {
    const dir = setupConfigDir();
    const config = loadConfig(dir);
    config.lanes.design_engineering.enabled = false;
    const packs = buildQueryPacks(config);

    expect(packs.some((p) => p.lane === "design_engineering")).toBe(false);
  });

  it("matches positive terms and rejects negative terms", () => {
    const pack: Parameters<typeof matchesQueryPack>[0] = {
      id: "test",
      label: "Test",
      target: "job",
      positiveTerms: ["design engineer", "product designer"],
      negativeTerms: ["senior", "lead"],
      locationFilters: [],
      sourceCaps: { maxPerSource: 10 },
      lane: "design_engineering",
    };

    expect(matchesQueryPack(pack, "We need a design engineer in Berlin").match).toBe(true);
    expect(matchesQueryPack(pack, "Senior design engineer wanted").match).toBe(false);
    expect(matchesQueryPack(pack, "Backend developer role").match).toBe(false);
  });

  it("blocks excluded domains", () => {
    const pack: Parameters<typeof isAllowedDomain>[0] = {
      id: "test",
      label: "Test",
      target: "job",
      positiveTerms: [],
      negativeTerms: [],
      locationFilters: [],
      sourceCaps: { maxPerSource: 10, excludedDomains: ["linkedin.com", "indeed.com"] },
      lane: "design_engineering",
    };

    expect(isAllowedDomain(pack, "https://example.com/jobs")).toBe(true);
    expect(isAllowedDomain(pack, "https://linkedin.com/jobs/view/123")).toBe(false);
    expect(isAllowedDomain(pack, "not-a-url")).toBe(false);
  });

  it("respects allowed domains when specified", () => {
    const pack: Parameters<typeof isAllowedDomain>[0] = {
      id: "test",
      label: "Test",
      target: "job",
      positiveTerms: [],
      negativeTerms: [],
      locationFilters: [],
      sourceCaps: { maxPerSource: 10, allowedDomains: ["greenhouse.io"] },
      lane: "design_engineering",
    };

    expect(isAllowedDomain(pack, "https://boards.greenhouse.io/example")).toBe(true);
    expect(isAllowedDomain(pack, "https://example.com/jobs")).toBe(false);
  });
});
