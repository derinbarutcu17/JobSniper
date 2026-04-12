import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { scoreListing } from "../src/scoring.js";
import { buildQueries } from "../src/search/queries.js";
import type { ListingCandidate, ProfileSummary } from "../src/types.js";
import { makeTempDir } from "./helpers.js";

const profile: ProfileSummary = {
  roleFamilies: ["design", "ai_coding"],
  targetSeniority: "junior",
  allowStretchRoles: false,
  avoidTitleTerms: ["senior", "lead", "manager", "director", "head", "principal", "staff"],
  preferredLocations: ["Berlin", "Germany", "Remote"],
  languagePreference: ["en", "de"],
  toolSignals: ["figma", "design systems", "typescript", "python", "agent"],
  summary: "Product-focused design and AI tooling profile.",
};

function listing(partial: Partial<ListingCandidate>): ListingCandidate {
  return {
    lane: "design_jobs",
    externalId: "listing-1",
    title: "Product Designer",
    titleFamily: "",
    company: "ModaAI",
    location: "Berlin",
    country: "Germany",
    language: "en",
    workModel: "hybrid",
    employmentType: "full-time",
    salary: "",
    description: "Figma, design systems, UX, and product design role in Berlin.",
    url: "https://jobs.example.com/designer",
    applyUrl: "https://jobs.example.com/designer",
    source: "test",
    sourceType: "page",
    sourceUrls: ["https://jobs.example.com/designer"],
    companyUrl: "https://moda.ai",
    careersUrl: "https://moda.ai/careers",
    aboutUrl: "",
    teamUrl: "",
    contactUrl: "",
    pressUrl: "",
    companyLinkedinUrl: "",
    publicContacts: [],
    postedAt: "",
    validThrough: "",
    department: "",
    experienceYearsText: "",
    remoteScope: "",
    applicantLocationRequirements: [],
    applicationContactName: "",
    applicationContactEmail: "",
    parseConfidence: 0.8,
    sourceConfidence: 0.8,
    isRealJobPage: true,
    raw: {},
    ...partial,
  };
}

describe("scoring", () => {
  it("prioritizes Berlin design roles", () => {
    const config = loadConfig(makeTempDir());
    const scored = scoreListing(config, profile, listing({}));
    expect(scored.score).toBeGreaterThan(55);
    expect(scored.category).not.toBe("Excluded");
  });

  it("keeps manager mentions in description as soft negatives, not hard excludes", () => {
    const config = loadConfig(makeTempDir());
    const scored = scoreListing(
      config,
      profile,
      listing({
        description: "Product Designer reporting to a Design Manager with stakeholder management across product teams.",
      }),
    );
    expect(scored.category).not.toBe("Excluded");
    expect(scored.breakdown.negatives.some((entry) => entry.toLowerCase().includes("management"))).toBe(true);
  });

  it("hard excludes senior titles", () => {
    const config = loadConfig(makeTempDir());
    const scored = scoreListing(config, profile, listing({ title: "Senior Product Designer" }));
    expect(scored.category).toBe("Excluded");
    expect(scored.eligibility).toBe("excluded");
  });

  it("does not hard exclude startup-friendly founding titles", () => {
    const config = loadConfig(makeTempDir());
    const scored = scoreListing(
      config,
      profile,
      listing({
        title: "Founding Designer",
        description: "Early-stage startup design role with Figma and product design.",
      }),
    );
    expect(scored.category).not.toBe("Excluded");
    expect(scored.breakdown.gatesFailed).not.toContain("title_seniority");
  });

  it("honors config blacklist title terms for hard title gating", () => {
    const baseDir = makeTempDir();
    fs.writeFileSync(
      path.join(baseDir, "config.json"),
      JSON.stringify(
        {
          blacklist: {
            titleTerms: ["staff"],
          },
        },
        null,
        2,
      ),
    );

    const config = loadConfig(baseDir);
    const scored = scoreListing(config, profile, listing({ title: "Staff Product Designer" }));
    expect(scored.category).toBe("Excluded");
    expect(scored.breakdown.gatesFailed).toContain("title_seniority");
    expect(scored.rationale.toLowerCase()).toContain("staff");
  });

  it("excludes closed roles from explicit closure text", () => {
    const config = loadConfig(makeTempDir());
    const scored = scoreListing(
      config,
      profile,
      listing({ description: "Applications closed. This role is no longer hiring." }),
    );
    expect(scored.category).toBe("Excluded");
  });

  it("excludes non-remote roles outside Berlin and Germany", () => {
    const config = loadConfig(makeTempDir());
    const scored = scoreListing(
      config,
      profile,
      listing({
        location: "Istanbul",
        country: "Turkey",
        workModel: "hybrid",
        description: "Hybrid Figma and product design role based in Istanbul.",
      }),
    );
    expect(scored.category).toBe("Excluded");
    expect(scored.breakdown.gatesFailed).toContain("location_outside_target");
  });

  it("supports custom role packs without code changes", () => {
    const baseDir = makeTempDir();
    fs.writeFileSync(
      path.join(baseDir, "config.json"),
      JSON.stringify(
        {
          lanes: {
            policy_jobs: {
              label: "Policy Jobs",
              type: "job",
              enabled: true,
              queries: {
                tr: [],
                en: ["berlin climate policy jobs"],
              },
              keywords: ["policy analyst", "climate policy", "public affairs"],
              queryTerms: ["policy analyst", "public policy associate"],
              profileSignals: ["policy", "climate policy", "research", "public affairs"],
              titleFamilies: [{ family: "Policy Analyst", terms: ["policy analyst", "public policy associate"] }],
              mismatchTerms: ["sales", "account executive"],
            },
          },
          blacklist: {
            lanes: {
              policy_jobs: [],
            },
          },
        },
        null,
        2,
      ),
    );

    const config = loadConfig(baseDir);
    const customProfile: ProfileSummary = {
      ...profile,
      roleFamilies: ["policy_jobs"],
      toolSignals: ["policy", "climate policy", "research", "public affairs"],
      summary: "Climate policy and research profile.",
    };

    const queries = buildQueries(config, customProfile);
    expect(queries.some((query) => query.lane === "policy_jobs")).toBe(true);
    expect(queries.some((query) => query.lane === "policy_jobs" && /policy|public affairs/i.test(query.query))).toBe(true);

    const scored = scoreListing(
      config,
      customProfile,
      listing({
        lane: "policy_jobs",
        title: "Policy Analyst",
        description: "Climate policy, research, and public affairs role in Berlin.",
      }),
    );
    expect(scored.category).not.toBe("Excluded");
    expect(scored.titleFamily).toBe("Policy Analyst");
    expect(scored.score).toBeGreaterThan(45);
  });

  it("expands title normalization for hybrid design and automation roles", () => {
    const config = loadConfig(makeTempDir());
    expect(listing({ lane: "design_jobs", title: "Design Technologist" }).lane).toBe("design_jobs");
    expect(scoreListing(config, profile, listing({ title: "Design Technologist" })).titleFamily).toBe("Design Engineer");
    expect(scoreListing(config, profile, listing({ title: "Visual Designer" })).titleFamily).toBe("UI/UX Designer");
    expect(scoreListing(config, profile, listing({ lane: "ai_coding_jobs", title: "Agent Workflow Builder" })).titleFamily).toBe("Automation Engineer");
    expect(scoreListing(config, profile, listing({ title: "Design Systems Engineer" })).titleFamily).toBe("Design Engineer");
  });
});
