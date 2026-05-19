import { describe, expect, it } from "vitest";
import { inferPitch } from "../src/normalization/pitch.js";
import type { ListingCandidate, ProfileSummary } from "../src/types.js";

describe("pitch generation", () => {
  it("finds a design engineering wedge when design and code both appear", () => {
    const profile: ProfileSummary = {
      roleFamilies: ["design_jobs"],
      targetSeniority: "mid",
      allowStretchRoles: true,
      avoidTitleTerms: [],
      preferredLocations: ["Berlin"],
      languagePreference: ["en"],
      toolSignals: ["figma", "react", "typescript", "design systems"],
      summary: "Design engineer profile",
    };
    const listing: ListingCandidate = {
      lane: "design_jobs",
      externalId: "1",
      title: "Design Engineer",
      titleFamily: "",
      company: "North",
      location: "Berlin",
      country: "Germany",
      language: "en",
      workModel: "hybrid",
      employmentType: "",
      salary: "",
      description: "Own design systems and React implementation for a small startup team.",
      url: "https://jobs.example.com/1",
      applyUrl: "https://jobs.example.com/1",
      source: "test",
      sourceType: "page",
      sourceUrls: [],
      companyUrl: "",
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
    };
    const pitch = inferPitch(listing, profile);
    expect(pitch.pitchTheme).toBe("design_engineering");
    expect(pitch.strongestProfileSignal).toBeTruthy();
    expect(pitch.pitchAngle.length).toBeGreaterThan(20);
  });

  it("prefers ai_workflows when the role is clearly AI-native", () => {
    const profile: ProfileSummary = {
      roleFamilies: ["design_jobs", "ai_coding_jobs"],
      targetSeniority: "mid",
      allowStretchRoles: true,
      avoidTitleTerms: [],
      preferredLocations: ["Berlin"],
      languagePreference: ["en"],
      toolSignals: ["figma", "react", "typescript", "agent workflows", "openai"],
      summary: "Hybrid creative technologist profile",
    };
    const listing: ListingCandidate = {
      lane: "ai_coding_jobs",
      externalId: "2",
      title: "AI Product Engineer",
      titleFamily: "",
      company: "Signal Forge",
      location: "Berlin",
      country: "Germany",
      language: "en",
      workModel: "hybrid",
      employmentType: "",
      salary: "",
      description: "Build agent workflows, LLM product loops, and TypeScript systems for a small team shipping quickly.",
      url: "https://jobs.example.com/2",
      applyUrl: "https://jobs.example.com/2",
      source: "test",
      sourceType: "page",
      sourceUrls: [],
      companyUrl: "",
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
    };
    const pitch = inferPitch(listing, profile);
    expect(pitch.pitchTheme).toBe("ai_workflows");
    expect(pitch.strongestCompanySignal).toMatch(/ai|agent|workflow/i);
  });
});
