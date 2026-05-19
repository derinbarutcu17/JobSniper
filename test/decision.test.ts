import { describe, expect, it } from "vitest";
import { buildDecisionSnapshot } from "../src/normalization/decision.js";
import type { ListingCandidate, ProfileSummary, ScoreBreakdown } from "../src/types.js";

const profile: ProfileSummary = {
  roleFamilies: ["ai_coding_jobs"],
  targetSeniority: "mid",
  allowStretchRoles: true,
  avoidTitleTerms: ["senior", "lead", "manager"],
  preferredLocations: ["Berlin", "Germany"],
  languagePreference: ["en", "de"],
  toolSignals: ["typescript", "agent", "react", "automation"],
  summary: "Builder profile",
};

function breakdown(): ScoreBreakdown {
  return {
    titleFit: 18,
    skillFit: 16,
    seniorityFit: 10,
    locationFit: 12,
    workModelFit: 8,
    languageFit: 6,
    companyFit: 4,
    startupFit: 10,
    freshnessFit: 4,
    contactabilityFit: 12,
    sourceQualityFit: 6,
    positives: ["Strong title fit", "startup signal"],
    negatives: [],
    gatesPassed: ["title_family", "location_fit"],
    gatesFailed: [],
  };
}

function listing(partial: Partial<ListingCandidate> = {}): ListingCandidate {
  return {
    lane: "ai_coding_jobs",
    externalId: "job-1",
    title: "AI Product Engineer",
    titleFamily: "AI Engineer",
    company: "Flux",
    location: "Berlin",
    country: "Germany",
    language: "en",
    workModel: "hybrid",
    employmentType: "full-time",
    salary: "",
    description: "Build agent workflows for a seed-stage startup with TypeScript and React.",
    url: "https://jobs.example.com/1",
    applyUrl: "https://jobs.example.com/1",
    source: "test",
    sourceType: "ats",
    sourceUrls: ["https://jobs.example.com/1"],
    companyUrl: "https://flux.example.com",
    careersUrl: "https://flux.example.com/careers",
    aboutUrl: "https://flux.example.com/about",
    teamUrl: "https://flux.example.com/team",
    contactUrl: "https://flux.example.com/contact",
    pressUrl: "",
    companyLinkedinUrl: "",
    publicContacts: [
      {
        kind: "careers_email",
        name: "",
        title: "",
        email: "jobs@flux.example.com",
        linkedinUrl: "",
        sourceUrl: "https://flux.example.com/careers",
        confidence: "high",
        evidenceType: "mailto",
        evidenceExcerpt: "jobs@flux.example.com",
        isPublic: true,
        pageType: "career_hub",
      },
    ],
    postedAt: "2026-03-20",
    validThrough: "",
    department: "",
    experienceYearsText: "",
    remoteScope: "",
    applicantLocationRequirements: [],
    applicationContactName: "",
    applicationContactEmail: "",
    parseConfidence: 0.95,
    sourceConfidence: 0.9,
    isRealJobPage: true,
    raw: {},
    ...partial,
  };
}

describe("decision layer", () => {
  it("recommends apply_now for high-fit real jobs", () => {
    const decision = buildDecisionSnapshot(listing(), profile, 78, breakdown(), "eligible");
    expect(decision.recommendation).toBe("apply_now");
    expect(decision.recommendedRoute).toBe("ats_plus_cold_email");
    expect(decision.pitchTheme).toBe("ai_workflows");
  });

  it("recommends enrich_first when the company looks good but route is weak", () => {
    const decision = buildDecisionSnapshot(
      listing({ publicContacts: [], isRealJobPage: false, sourceType: "search" }),
      profile,
      58,
      breakdown(),
      "eligible",
    );
    expect(decision.recommendation).toBe("enrich_first");
  });

  it("prefers cold_email for strong founder-surface opportunities on real pages", () => {
    const decision = buildDecisionSnapshot(
      listing({
        publicContacts: [],
        sourceType: "page",
      }),
      profile,
      72,
      breakdown(),
      "eligible",
    );
    expect(decision.recommendation).toBe("cold_email");
    expect(decision.recommendedRoute).toBe("founder_or_team_reachout");
  });

  it("downgrades weak page surfaces to enrich_first instead of overcommitting", () => {
    const decision = buildDecisionSnapshot(
      listing({
        publicContacts: [],
        sourceType: "search",
        isRealJobPage: false,
        parseConfidence: 0.32,
        sourceConfidence: 0.42,
      }),
      profile,
      72,
      breakdown(),
      "eligible",
    );
    expect(decision.recommendation).toBe("enrich_first");
    expect(decision.recommendedRoute).toBe("watch_company");
    expect(decision.routeConfidence).toBeLessThan(0.6);
  });
});
