import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/normalization/config.js";
import { scoreListing } from "../src/normalization/scoring.js";
import { buildQueries } from "../src/ingestion/search/queries.js";
import type { ListingCandidate, ProfileSummary } from "../src/types.js";

const config = loadConfig(process.cwd());

const profile: ProfileSummary = {
  roleFamilies: ["design_engineering"],
  targetSeniority: "junior",
  allowStretchRoles: false,
  avoidTitleTerms: ["senior", "lead", "manager", "director", "head", "principal", "staff"],
  preferredLocations: ["Berlin", "Remote"],
  languagePreference: ["en", "de"],
  toolSignals: ["figma", "design systems", "typescript", "react", "tailwind", "ux", "creative technology", "prototyping"],
  summary: "Design engineer and creative technologist building product interfaces with React, TypeScript, and Figma.",
};

function listing(partial: Partial<ListingCandidate>): ListingCandidate {
  return {
    lane: "design_engineering",
    externalId: "test-1",
    title: "Design Engineer",
    titleFamily: "",
    company: "TestCo",
    location: "Berlin",
    country: "Germany",
    language: "en",
    workModel: "hybrid",
    employmentType: "full-time",
    salary: "",
    description: "Figma, design systems, and React role in Berlin building product interfaces.",
    url: "https://jobs.example.com/1",
    applyUrl: "https://jobs.example.com/1",
    source: "test",
    sourceType: "page",
    sourceUrls: ["https://jobs.example.com/1"],
    companyUrl: "https://testco.example.com",
    careersUrl: "",
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

describe("scoring with design_engineering lane", () => {
  it("scores a Design Engineer role as a Good Match", () => {
    const result = scoreListing(config, profile, listing({}));
    expect(result.category).not.toBe("Excluded");
    expect(result.titleFamily).toBe("Design Engineer");
    expect(result.score).toBeGreaterThan(50);
  });

  it("classifies Creative Technologist into the right title family", () => {
    const result = scoreListing(config, profile, listing({ title: "Creative Technologist" }));
    expect(result.category).not.toBe("Excluded");
    expect(result.titleFamily).toBe("Creative Technologist");
  });

  it("classifies Product Designer correctly", () => {
    const result = scoreListing(config, profile, listing({ title: "Product Designer" }));
    expect(result.category).not.toBe("Excluded");
    expect(result.titleFamily).toBe("Product Designer");
  });

  it("excludes Senior titles via title_seniority gate", () => {
    const result = scoreListing(config, profile, listing({ title: "Senior Product Designer" }));
    expect(result.category).toBe("Excluded");
    expect(result.breakdown.gatesFailed).toContain("title_seniority");
    expect(result.eligibility).toBe("excluded");
  });

  it("excludes AI Engineer titles via role_family_mismatch", () => {
    const result = scoreListing(config, profile, listing({ title: "AI Engineer", description: "Building ML models and agent systems in Berlin." }));
    expect(result.category).toBe("Excluded");
    expect(result.breakdown.gatesFailed).toContain("role_family_mismatch");
  });

  it("excludes ML Engineer titles via role_family_mismatch", () => {
    const result = scoreListing(config, profile, listing({ title: "ML Engineer" }));
    expect(result.category).toBe("Excluded");
    expect(result.breakdown.gatesFailed).toContain("role_family_mismatch");
  });

  it("excludes Backend Engineer via role_family_mismatch", () => {
    const result = scoreListing(config, profile, listing({ title: "Backend Engineer" }));
    expect(result.category).toBe("Excluded");
  });

  it("does NOT exclude Founding Designer", () => {
    const result = scoreListing(config, profile, listing({ title: "Founding Designer", description: "Early-stage startup design role with Figma and product design." }));
    expect(result.category).not.toBe("Excluded");
    expect(result.breakdown.gatesFailed).not.toContain("title_seniority");
  });

  it("excludes roles outside Berlin/Germany for non-remote", () => {
    const result = scoreListing(config, profile, listing({ location: "Istanbul", country: "Turkey", workModel: "onsite", description: "Onsite design role in Istanbul." }));
    expect(result.category).toBe("Excluded");
    expect(result.breakdown.gatesFailed).toContain("location_outside_target");
  });

  it("excludes remote roles in foreign countries", () => {
    const result = scoreListing(config, profile, listing({ location: "Remote", country: "US", workModel: "remote", description: "Remote role based in the US." }));
    expect(result.category).toBe("Excluded");
    expect(result.breakdown.gatesFailed).toContain("location_outside_target");
  });

  it("does not exclude a Berlin role with 'Full-time' in description", () => {
    const result = scoreListing(config, profile, listing({ description: "Full-time position. Figma, design systems, and React role in Berlin building product interfaces." }));
    expect(result.category).not.toBe("Excluded");
  });

  it("builds queries for design_engineering lane", () => {
    const queries = buildQueries(config, profile);
    const deQueries = queries.filter((q) => q.lane === "design_engineering");
    expect(deQueries.length).toBeGreaterThan(0);
    expect(deQueries.some((q) => q.query.includes("design engineer"))).toBe(true);
  });
});
