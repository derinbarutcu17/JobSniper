import { describe, expect, it } from "vitest";
import {
  buildApplicationReasons,
  dedupeApplications,
  normalizeCompanyToken,
  rankOutreach,
  scoreApplicationFit,
  shouldExcludeOutreachCandidate,
} from "../src/normalization/tomorrow-sourcing.js";

describe("tomorrow sourcing helpers", () => {
  it("normalizes company names aggressively enough for seed dedupe", () => {
    expect(normalizeCompanyToken("Pandata GmbH")).toBe("pandata");
    expect(normalizeCompanyToken("Plan A")).toBe("plan a");
    expect(normalizeCompanyToken("Tällbeard Studio")).toBe("t llbeard");
  });

  it("excludes outreach candidates from seed, db, and gmail evidence", () => {
    const seed = new Set(["bliq"]);
    const db = new Set(["pandata", "pandata.de"]);
    const gmailHigh = new Set(["voize"]);
    const gmailMedium = new Set(["n26"]);

    expect(shouldExcludeOutreachCandidate({ companyName: "Bliq", seedMatches: seed, dbMatches: db, gmailHighMatches: gmailHigh, gmailMediumMatches: gmailMedium }).excluded).toBe(true);
    expect(shouldExcludeOutreachCandidate({ companyName: "Pandata GmbH", domain: "pandata.de", seedMatches: seed, dbMatches: db, gmailHighMatches: gmailHigh, gmailMediumMatches: gmailMedium }).excluded).toBe(true);
    expect(shouldExcludeOutreachCandidate({ companyName: "voize", seedMatches: seed, dbMatches: db, gmailHighMatches: gmailHigh, gmailMediumMatches: gmailMedium }).excluded).toBe(true);
    expect(shouldExcludeOutreachCandidate({ companyName: "FreshCo", seedMatches: seed, dbMatches: db, gmailHighMatches: gmailHigh, gmailMediumMatches: gmailMedium }).excluded).toBe(false);
  });

  it("scores design-plus-builder Berlin roles above backend-only roles", () => {
    const profile = {
      summary: "",
      toolSignals: ["product design", "ui", "brand", "creative", "ai", "typescript", "react", "startup"],
      preferredLocations: ["Berlin"],
      targetSeniority: "junior",
    };

    const strong = scoreApplicationFit({
      title: "Design Engineer",
      location: "Berlin",
      text: "Design Engineer Berlin React TypeScript AI product",
      sourceTrust: 1,
      profile,
    });
    const weak = scoreApplicationFit({
      title: "Senior Backend Platform Engineer",
      location: "Berlin",
      text: "Senior backend platform infrastructure role",
      sourceTrust: 1,
      profile,
    });

    expect(strong).toBeGreaterThan(weak);
    expect(buildApplicationReasons({ title: "Design Engineer", text: "AI product role", location: "Berlin", profile })).toContain("direct design-and-engineering overlap");
  });

  it("dedupes duplicate applications by company and role", () => {
    const ranked = dedupeApplications([
      {
        company: "Langdock",
        role: "Design Engineer",
        whyItFits: "",
        applicationLink: "https://example.com/1",
        urgency: "high",
        confidence: "high",
        whyItBeatAlternatives: "",
        source: "test",
        score: 80,
        evidence: [],
        nextAction: "",
      },
      {
        company: "Langdock",
        role: "Design Engineer",
        whyItFits: "",
        applicationLink: "https://example.com/2",
        urgency: "medium",
        confidence: "medium",
        whyItBeatAlternatives: "",
        source: "test",
        score: 60,
        evidence: [],
        nextAction: "",
      },
    ]);

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.applicationLink).toBe("https://example.com/1");
  });

  it("ranks stronger contact confidence first for outreach", () => {
    const ranked = rankOutreach([
      {
        company: "Alpha",
        whyItFits: "",
        contactRoute: "hello@alpha.com",
        whoToAddress: "Team",
        contactConfidence: "medium",
        whyItIsFresh: "",
        nextAction: "",
        score: 20,
        evidence: [],
      },
      {
        company: "Beta",
        whyItFits: "",
        contactRoute: "jobs@beta.com",
        whoToAddress: "Hiring team",
        contactConfidence: "high",
        whyItIsFresh: "",
        nextAction: "",
        score: 20,
        evidence: [],
      },
    ]);

    expect(ranked[0]?.company).toBe("Beta");
  });
});
