import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/normalization/config.js";
import { earlyFilterListing } from "../src/normalization/listing-filter.js";
import type { ListingCandidate, ProfileSummary } from "../src/types.js";
import { makeTempDir } from "./helpers.js";

const profile: ProfileSummary = {
  roleFamilies: ["design_jobs"],
  targetSeniority: "junior",
  allowStretchRoles: false,
  avoidTitleTerms: ["senior", "lead", "manager", "director", "head", "principal", "staff"],
  preferredLocations: ["Berlin", "Remote"],
  languagePreference: ["en", "de"],
  toolSignals: ["figma", "design systems"],
  summary: "Design profile",
};

function listing(partial: Partial<ListingCandidate> = {}): ListingCandidate {
  return {
    lane: "design_jobs",
    title: "Product Designer",
    titleFamily: "Product Designer",
    company: "ModaAI",
    location: "Berlin",
    country: "Germany",
    language: "en",
    workModel: "hybrid",
    employmentType: "full-time",
    salary: "",
    description: "Figma and design systems role in Berlin.",
    url: "https://jobs.example.com/designer",
    applyUrl: "https://jobs.example.com/designer",
    source: "test",
    sourceType: "page",
    sourceUrls: ["https://jobs.example.com/designer"],
    companyUrl: "https://moda.ai",
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
    parseConfidence: 0.9,
    sourceConfidence: 0.9,
    isRealJobPage: true,
    raw: {},
    ...partial,
  };
}

describe("early listing filter", () => {
  it("drops senior titles before persistence", () => {
    const config = loadConfig(makeTempDir());
    const decision = earlyFilterListing(config, profile, listing({ title: "Senior Product Designer" }));
    expect(decision.keep).toBe(false);
    expect(decision.reason).toBe("title_excluded");
  });

  it("drops out-of-zone roles before persistence", () => {
    const config = loadConfig(makeTempDir());
    const decision = earlyFilterListing(
      config,
      profile,
      listing({
        location: "New York",
        country: "US",
        workModel: "remote",
        description: "Remote product design role in New York.",
      }),
    );
    expect(decision.keep).toBe(false);
    expect(decision.reason).toBe("location_outside_target");
  });

  it("keeps Berlin-aligned roles", () => {
    const config = loadConfig(makeTempDir());
    const decision = earlyFilterListing(config, profile, listing());
    expect(decision.keep).toBe(true);
  });
});
