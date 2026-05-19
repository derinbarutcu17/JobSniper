import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { openDatabase, upsertCompany, upsertJob, upsertPageCache } from "../src/state/db.js";
import { loadConfig } from "../src/normalization/config.js";
import { makeTempDir } from "./helpers.js";

describe("legacy migration", () => {
  it("migrates the legacy jobs table into normalized tables", () => {
    const baseDir = makeTempDir();
    fs.mkdirSync(path.join(baseDir, "data"), { recursive: true });
    const legacy = new Database(path.join(baseDir, "data", "sniper.db"));
    legacy.exec(`
      CREATE TABLE jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        external_id TEXT UNIQUE,
        title TEXT,
        company TEXT,
        location TEXT,
        salary TEXT,
        description TEXT,
        url TEXT,
        source TEXT,
        status TEXT DEFAULT 'new',
        category TEXT DEFAULT 'Low Match',
        match_score INTEGER DEFAULT 0,
        match_rationale TEXT,
        relevant_projects TEXT,
        discovery_logic TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
    legacy
      .prepare(
        "INSERT INTO jobs (external_id, title, company, location, description, url, source, match_score) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "legacy-1",
        "Product Designer",
        "ModaAI",
        "Istanbul",
        "Figma and design systems",
        "https://jobs.example.com/designer-1",
        "legacy-rss",
        88,
      );
    legacy.close();

    const { db } = openDatabase(baseDir);
    const job = db.prepare("SELECT * FROM jobs").get() as { title: string; company_name: string; score: number };
    const company = db.prepare("SELECT * FROM companies").get() as { name: string };
    const jobColumns = db.prepare("PRAGMA table_info(jobs)").all() as Array<{ name: string }>;
    const companyColumns = db.prepare("PRAGMA table_info(companies)").all() as Array<{ name: string }>;
    const contactLogTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'contact_log'").get() as { name: string } | undefined;
    const outcomeLogTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'outcome_log'").get() as { name: string } | undefined;
    const runsTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runs'").get() as { name: string } | undefined;
    const applicationsTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'applications'").get() as { name: string } | undefined;
    const applicationEventsTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'application_events'").get() as { name: string } | undefined;
    const runMetricColumns = db.prepare("PRAGMA table_info(run_metrics)").all() as Array<{ name: string }>;

    expect(job.title).toBe("Product Designer");
    expect(job.company_name).toBe("ModaAI");
    expect(job.score).toBe(88);
    expect(company.name).toBe("ModaAI");
    expect(jobColumns.some((column) => column.name === "recommendation")).toBe(true);
    expect(companyColumns.some((column) => column.name === "best_route")).toBe(true);
    expect(contactLogTable?.name).toBe("contact_log");
    expect(outcomeLogTable?.name).toBe("outcome_log");
    expect(runsTable?.name).toBe("runs");
    expect(applicationsTable?.name).toBe("applications");
    expect(applicationEventsTable?.name).toBe("application_events");
    expect(runMetricColumns.some((column) => column.name === "run_id")).toBe(true);
    expect(jobColumns.some((column) => column.name === "pipeline_status")).toBe(true);
    expect(jobColumns.some((column) => column.name === "asset_bundle_path")).toBe(true);
  });

  it("keeps company merges additive and prefers normalized URLs for job keys", () => {
    const baseDir = makeTempDir();
    const { db } = openDatabase(baseDir);
    const config = loadConfig(baseDir);

    upsertCompany(db, {
      canonicalKey: "company:example",
      name: "Example",
      domain: "example.com",
      location: "Berlin",
      companyUrl: "https://example.com",
      careersUrl: "",
      aboutUrl: "",
      teamUrl: "",
      contactUrl: "",
      pressUrl: "",
      linkedinUrl: "",
      description: "first",
      sourceUrls: ["https://example.com"],
      publicContacts: ["hello@example.com"],
      startupSignals: ["seed"],
      hiringSignals: ["hiring"],
      founderNames: [],
      cities: ["Berlin"],
      sizeBand: "",
      stageText: "seed",
      remotePolicy: "hybrid",
      openRoleCount: 1,
      startupScore: 5,
      companyFitScore: 4,
      hiringSignalScore: 4,
      contactabilityScore: 4,
      isStartupCandidate: true,
      lastSeenAt: new Date().toISOString(),
    });
    upsertCompany(db, {
      canonicalKey: "company:example",
      name: "Example",
      domain: "",
      location: "",
      companyUrl: "",
      careersUrl: "",
      aboutUrl: "https://example.com/about",
      teamUrl: "",
      contactUrl: "",
      pressUrl: "",
      linkedinUrl: "",
      description: "",
      sourceUrls: ["https://example.com/about"],
      publicContacts: ["team@example.com"],
      startupSignals: [],
      hiringSignals: [],
      founderNames: [],
      cities: [],
      sizeBand: "",
      stageText: "",
      remotePolicy: "",
      openRoleCount: 2,
      startupScore: 7,
      companyFitScore: 3,
      hiringSignalScore: 2,
      contactabilityScore: 6,
      isStartupCandidate: false,
      lastSeenAt: new Date().toISOString(),
    });

    const profile = {
      roleFamilies: ["design_jobs"],
      targetSeniority: "junior" as const,
      allowStretchRoles: false,
      avoidTitleTerms: ["senior"],
      preferredLocations: ["Berlin"],
      languagePreference: ["en"],
      toolSignals: ["figma"],
      summary: "designer",
    };
    const breakdown = {
      titleFit: 1,
      skillFit: 1,
      seniorityFit: 1,
      locationFit: 1,
      workModelFit: 1,
      languageFit: 1,
      companyFit: 1,
      startupFit: 1,
      freshnessFit: 1,
      contactabilityFit: 1,
      sourceQualityFit: 1,
      positives: [],
      negatives: [],
      gatesPassed: [],
      gatesFailed: [],
    };

    upsertJob(
      db,
      config,
      {
        lane: "design_jobs",
        externalId: "job-1",
        title: "Product Designer",
        titleFamily: "Product Designer",
        company: "Example",
        location: "Berlin",
        country: "Germany",
        language: "en",
        workModel: "hybrid",
        employmentType: "full-time",
        salary: "",
        description: "Figma role",
        url: "https://jobs.example.com/role?utm_source=x",
        applyUrl: "https://jobs.example.com/role?utm_source=x",
        source: "rss",
        sourceType: "page",
        sourceUrls: ["https://jobs.example.com/role?utm_source=x"],
        companyUrl: "https://example.com",
        careersUrl: "",
        aboutUrl: "",
        teamUrl: "",
        contactUrl: "",
        pressUrl: "",
        companyLinkedinUrl: "",
        publicContacts: [],
        postedAt: "2026-03-01",
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
      },
      80,
      "Good Match",
      "rationale",
      ["figma"],
      profile,
      breakdown,
      "eligible",
    );
    upsertJob(
      db,
      config,
      {
        lane: "design_jobs",
        externalId: "job-2",
        title: "Product Designer",
        titleFamily: "Product Designer",
        company: "Example",
        location: "Berlin",
        country: "Germany",
        language: "en",
        workModel: "hybrid",
        employmentType: "full-time",
        salary: "",
        description: "Figma role",
        url: "https://jobs.example.com/role?utm_source=y",
        applyUrl: "https://jobs.example.com/role?utm_source=y",
        source: "ats",
        sourceType: "page",
        sourceUrls: ["https://jobs.example.com/role?utm_source=y"],
        companyUrl: "https://example.com",
        careersUrl: "",
        aboutUrl: "",
        teamUrl: "",
        contactUrl: "",
        pressUrl: "",
        companyLinkedinUrl: "",
        publicContacts: [],
        postedAt: "2026-03-01",
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
      },
      82,
      "Good Match",
      "rationale",
      ["figma"],
      profile,
      breakdown,
      "eligible",
    );

    const company = db.prepare("SELECT domain, source_urls, public_contacts, open_role_count FROM companies WHERE canonical_key = 'company:example'").get() as {
      domain: string;
      source_urls: string;
      public_contacts: string;
      open_role_count: number;
    };
    const jobs = db.prepare("SELECT canonical_key, url, score FROM jobs").all() as Array<{ canonical_key: string; url: string; score: number }>;

    expect(company.domain).toBe("example.com");
    expect(company.source_urls).toContain("https://example.com");
    expect(company.source_urls).toContain("https://example.com/about");
    expect(company.public_contacts).toContain("hello@example.com");
    expect(company.public_contacts).toContain("team@example.com");
    expect(company.open_role_count).toBe(2);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.canonical_key).toContain("https-jobs-example-com-role");
    expect(jobs[0]?.score).toBe(82);
  });

  it("replaces generic seeded startup labels with stronger enrichment evidence", () => {
    const baseDir = makeTempDir();
    const { db } = openDatabase(baseDir);

    upsertCompany(db, {
      canonicalKey: "company:stage-test",
      name: "Stage Test",
      domain: "stagetest.ai",
      location: "Berlin",
      companyUrl: "https://stagetest.ai",
      careersUrl: "",
      aboutUrl: "",
      teamUrl: "",
      contactUrl: "",
      pressUrl: "",
      linkedinUrl: "",
      description: "seed row",
      sourceUrls: ["https://stagetest.ai"],
      publicContacts: [],
      startupSignals: ["startup_language"],
      hiringSignals: [],
      founderNames: [],
      cities: ["Berlin"],
      sizeBand: "",
      stageText: "Berlin startup list",
      remotePolicy: "",
      openRoleCount: 0,
      startupScore: 14,
      companyFitScore: 4,
      hiringSignalScore: 0,
      contactabilityScore: 0,
      isStartupCandidate: true,
      lastSeenAt: new Date().toISOString(),
    });

    upsertCompany(db, {
      canonicalKey: "company:stage-test",
      name: "Stage Test",
      domain: "stagetest.ai",
      location: "Berlin",
      companyUrl: "https://stagetest.ai",
      careersUrl: "",
      aboutUrl: "",
      teamUrl: "",
      contactUrl: "",
      pressUrl: "",
      linkedinUrl: "",
      description: "current company site",
      sourceUrls: ["https://stagetest.ai/about"],
      publicContacts: [],
      startupSignals: [],
      hiringSignals: [],
      founderNames: [],
      cities: ["Berlin"],
      sizeBand: "201-500",
      stageText: "",
      remotePolicy: "",
      openRoleCount: 0,
      startupScore: 8,
      companyFitScore: 4,
      hiringSignalScore: 0,
      contactabilityScore: 0,
      isStartupCandidate: false,
      lastSeenAt: new Date().toISOString(),
    });

    const company = db
      .prepare("SELECT stage_text, startup_score, is_startup_candidate FROM companies WHERE canonical_key = 'company:stage-test'")
      .get() as { stage_text: string; startup_score: number; is_startup_candidate: number };

    expect(company.stage_text).toBe("");
    expect(company.startup_score).toBe(8);
    expect(company.is_startup_candidate).toBe(0);
  });

  it("writes page cache rows with the expected snake_case bindings", () => {
    const baseDir = makeTempDir();
    const { db } = openDatabase(baseDir);

    expect(() =>
      upsertPageCache(db, {
        normalizedUrl: "https://example.com/jobs/1",
        url: "https://example.com/jobs/1?utm_source=x",
        domain: "example.com",
        sourceType: "page",
        intent: "job",
        pageType: "job_detail",
        html: "<html><body>job</body></html>",
        text: "job",
        fetchStatus: 200,
        usedBrowserFallback: false,
      }),
    ).not.toThrow();

    const row = db.prepare("SELECT normalized_url, url, source_type, fetch_status, used_browser_fallback FROM pages").get() as {
      normalized_url: string;
      url: string;
      source_type: string;
      fetch_status: number;
      used_browser_fallback: number;
    };

    expect(row.normalized_url).toBe("https://example.com/jobs/1");
    expect(row.url).toBe("https://example.com/jobs/1?utm_source=x");
    expect(row.source_type).toBe("page");
    expect(row.fetch_status).toBe(200);
    expect(row.used_browser_fallback).toBe(0);
  });
});
