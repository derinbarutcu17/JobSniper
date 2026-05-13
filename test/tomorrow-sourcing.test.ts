import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/state/db.js";
import { presentTomorrowSourcing } from "../src/presentation/presenters.js";
import { buildGmailSearchTargets } from "../src/state/services/tomorrow-sourcing-service.js";
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

  it("builds Gmail Sent search targets from seed companies, company records, domains, and contacts", () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "sniper-tomorrow-"));
    fs.mkdirSync(path.join(baseDir, "data"), { recursive: true });
    fs.writeFileSync(
      path.join(baseDir, "data", "contacted-company-seed.json"),
      JSON.stringify({ companies: ["Bliq"] }, null, 2),
    );
    const { db } = openDatabase(baseDir);
    db.exec(`
      INSERT INTO companies (canonical_key, name, domain, company_url, careers_url, contact_url, created_at, updated_at)
      VALUES ('company:acme', 'Acme Berlin', 'acme.io', 'https://acme.io', 'https://jobs.acme.io', 'https://acme.io/contact', datetime('now'), datetime('now'));
      INSERT INTO contacts (canonical_key, company_id, email, created_at, updated_at)
      VALUES ('contact:acme-jobs', 1, 'jobs@acme.io', datetime('now'), datetime('now'));
    `);

    const targets = buildGmailSearchTargets(baseDir);
    expect(targets.some((target) => target.value === "Bliq" && target.confidence === "medium")).toBe(true);
    expect(targets.some((target) => target.value === "Acme Berlin" && target.confidence === "medium")).toBe(true);
    expect(targets.some((target) => target.value === "acme.io" && target.confidence === "high")).toBe(true);
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it("renders the six report sections with action-ready details", () => {
    const output = presentTomorrowSourcing({
      report: {
        generatedAt: "2026-05-12T10:00:00.000Z",
        gmailAudit: { available: true, reason: "ok", matches: [] },
        topApplications: [
          {
            company: "Langdock",
            role: "Design Engineer",
            whyItFits: "direct design-and-engineering overlap",
            applicationLink: "https://example.com/apply",
            urgency: "high",
            confidence: "high",
            whyItBeatAlternatives: "best fit",
            source: "test",
            score: 99,
            evidence: [],
            nextAction: "Apply tomorrow.",
          },
        ],
        reserveApplications: [],
        topOutreachCompanies: [
          {
            company: "FreshCo",
            whyItFits: "credible Berlin startup fit",
            targetType: "Hiring team",
            contactRoute: "jobs@freshco.dev",
            whoToAddress: "Hiring team",
            contactConfidence: "high",
            whyItIsFresh: "no strong contact match found",
            nextAction: "Email tomorrow.",
            score: 88,
            evidence: [],
          },
        ],
        reserveOutreachCompanies: [],
        excludedAlreadyContacted: [{ company: "Bliq", reason: "present in prior-contact seed list" }],
        excludedNotGoodEnough: [{ company: "WeakCo", reason: "not reachable enough for tomorrow outreach" }],
      },
    });

    expect(output).toContain("Top 5 Applications:");
    expect(output).toContain("Top 5 Berlin Startups to Email:");
    expect(output).toContain("Reserve Applications:");
    expect(output).toContain("Reserve Startups:");
    expect(output).toContain("Excluded Because Already Contacted:");
    expect(output).toContain("Excluded Because Not Good Enough:");
    expect(output).toContain("Why it fits:");
    expect(output).toContain("Next action tomorrow:");
    expect(output).toContain("Freshness:");
  });
});
