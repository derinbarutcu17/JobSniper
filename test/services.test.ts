import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/state/db.js";
import { createJobsService } from "../src/state/services/jobs-service.js";
import { createRunService } from "../src/state/services/run-service.js";
import { onboardProfile } from "../src/normalization/profile.js";
import { makeFetchStub, makeTempDir } from "./helpers.js";

describe("foundation services", () => {
  it("returns typed job detail shapes from the jobs service", () => {
    const baseDir = makeTempDir();
    const { db } = openDatabase(baseDir);
    db.exec(`
      INSERT INTO jobs (
        canonical_key, company_name, title, title_family, lane, score, eligibility, category,
        recommendation, recommended_route, route_confidence, location, work_model, url,
        pitch_theme, pitch_angle, strongest_profile_signal, strongest_company_signal,
        decision_explanation_json, public_contacts, source_urls, created_at, updated_at
      ) VALUES (
        'job:test', 'North', 'Design Engineer', 'Design Engineer', 'design_jobs', 78, 'eligible', 'Good Match',
        'cold_email', 'direct_email_first', 0.8, 'Berlin', 'hybrid', 'https://jobs.example.com/1',
        'design_engineering', 'Lead with hybrid design and code.', 'figma', 'design systems',
        '{"why_apply_now":[],"why_cold_email":["direct route"],"why_enrich_first":[],"why_watch":[],"why_discard":[]}',
        '[]', '["https://jobs.example.com/1"]', datetime('now'), datetime('now')
      );
    `);

    const service = createJobsService(baseDir);
    const detail = service.getJob(1);
    expect(detail?.canonicalKey).toBe("job:test");
    expect(detail?.companyName).toBe("North");
    expect(detail?.pitchTheme).toBe("design_engineering");
  });

  it("creates a first-class run record through the run service", async () => {
    const baseDir = makeTempDir();
    fs.writeFileSync(
      path.join(baseDir, "config.json"),
      JSON.stringify(
        {
          search: {
            maxResultsPerQuery: 1,
            maxQueriesPerLane: 0,
            minScoreThreshold: 20,
            browserFallback: false,
            priorityCities: ["Berlin"],
            priorityCountries: ["Germany"],
          },
          lanes: {
            design_jobs: {
              label: "Design Jobs",
              type: "job",
              enabled: true,
              queries: { tr: [], en: [] },
              keywords: ["figma"],
            },
          },
          sources: { rss: [], atsBoards: [] },
          blacklist: { companies: [], keywords: [], titleTerms: [], softPenaltyTerms: [], lanes: { design_jobs: [] } },
          sheets: { spreadsheetId: "", createIfMissing: true, folderId: "", tabs: { jobs: "Jobs", companies: "Companies", contacts: "Contacts", runMetrics: "RunMetrics" } },
        },
        null,
        2,
      ),
    );
    await onboardProfile(baseDir, "Berlin designer using Figma and React.");
    const service = createRunService(baseDir, makeFetchStub({}));
    const result = await service.run();

    expect(result.run.id).toBeGreaterThan(0);
    expect(result.run.status).toBe("succeeded");
    expect(result.summary.runId).toBe(result.run.id);
  });
});
