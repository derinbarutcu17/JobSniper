import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db.js";
import { onboardProfile } from "../src/profile.js";
import { runDiscovery } from "../src/search/discovery.js";
import { fixture, makeFetchStub, makeTempDir } from "./helpers.js";

describe("discovery integration", () => {
  it("stores Berlin and remote AI jobs from web search plus RSS", async () => {
    const baseDir = makeTempDir();
    fs.writeFileSync(
      path.join(baseDir, "config.json"),
      JSON.stringify(
        {
          search: {
            maxResultsPerQuery: 2,
            maxQueriesPerLane: 1,
            minScoreThreshold: 20,
            browserFallback: false,
            priorityCities: ["Berlin"],
            priorityCountries: ["Germany", "Deutschland"],
          },
          lanes: {
            design_jobs: {
              enabled: true,
              queries: { tr: [], en: ["design berlin"] },
              keywords: ["figma", "ux"],
            },
            ai_coding_jobs: {
              enabled: true,
              queries: { tr: [], en: ["ai berlin"] },
              keywords: ["agent", "typescript", "python"],
            },
            company_watch: {
              enabled: false,
              queries: { tr: [], en: [] },
              keywords: []
            }
          },
          sources: {
            rss: [{ name: "Sample Design Feed", url: "https://feed.example.com/rss" }],
            atsBoards: [],
            jobBoards: [
              { name: "LinkedIn Design", provider: "linkedin", lane: "design_jobs", query: "product designer ux ui", location: "Berlin, Germany", maxResults: 5 },
            ]
          },
          blacklist: {
            companies: [],
            keywords: [],
            lanes: { design_jobs: [], ai_coding_jobs: [], company_watch: [] }
          },
          sheets: {
            spreadsheetId: "",
            createIfMissing: true,
            folderId: "",
            tabs: { jobs: "Jobs", companies: "Companies", contacts: "Contacts" }
          }
        },
        null,
        2,
      ),
    );

    await onboardProfile(baseDir, "I build product design systems with Figma and AI tools in Berlin. Also comfortable with TypeScript and Python.");

    const deps = makeFetchStub({
      "https://html.duckduckgo.com/html/?q=design%20berlin": { body: fixture("search-results.html") },
      "https://html.duckduckgo.com/html/?q=ai%20berlin": { body: fixture("search-results.html") },
      "https://jobs.example.com/turkish-design-role": { body: fixture("turkish-job.html") },
      "https://jobs.example.com/agent-engineer": { body: fixture("remote-ai-job.html") },
      "https://feed.example.com/rss": { body: fixture("sample-rss.xml") },
      "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=product+designer+ux+ui&location=Berlin%2C+Germany&start=0&position=1&pageNum=0&count=5": {
        body: `
          <html><body>
            <div class="base-search-card">
              <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/22222222/?trackingId=x"></a>
              <h3 class="base-search-card__title">Junior Product Designer</h3>
              <h4 class="base-search-card__subtitle"><a href="https://www.linkedin.com/company/atlasmetrics/">Atlas Metrics</a></h4>
              <span class="job-search-card__location">Berlin, Germany</span>
              <div class="job-search-card__snippet">Hybrid design systems role for climate software.</div>
            </div>
          </body></html>
        `,
      },
    });

    const summary = await runDiscovery(baseDir, deps);
    const { db } = openDatabase(baseDir);
    const jobs = db.prepare("SELECT title, company_name FROM jobs ORDER BY id").all() as Array<Record<string, string>>;
    const contacts = db.prepare("SELECT email FROM contacts WHERE email != ''").all() as Array<{ email: string }>;

    expect(summary.totalFound).toBeGreaterThan(1);
    expect(jobs.some((job) => job.title.includes("UI/UX"))).toBe(true);
    expect(jobs.some((job) => job.title.includes("Agent Engineer"))).toBe(true);
    expect(jobs.some((job) => job.title.includes("Junior Product Designer"))).toBe(true);
    expect(contacts.some((contact) => contact.email === "hello@berlinstudio.com")).toBe(true);
  });
});
