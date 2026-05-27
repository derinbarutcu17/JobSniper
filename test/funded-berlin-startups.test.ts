import { describe, expect, it } from "vitest";
import { fundedBerlinInternals } from "../src/daily/funded-berlin-startups.js";
import type { FundedStartupSource } from "../src/types.js";

describe("funded berlin startups", () => {
  it("parses handpicked funded article companies with stage hints", () => {
    const source: FundedStartupSource = {
      name: "Handpicked Test",
      provider: "handpicked_berlin_article",
      url: "https://handpickedberlin.com/list-of-funded-startups-in-berlin-january-2026/",
      maxCompanies: 10,
    };
    const html = `
      <html>
        <head>
          <meta property="article:published_time" content="2026-01-01T08:00:00.000Z" />
          <title>List of funded startups in Berlin: January 2026</title>
        </head>
        <body>
          <main>
            <h1>List of funded startups in Berlin: January 2026</h1>
            <p>Parloa - $350M Series D for AI agents for customer service.</p>
            <p>GeneralMind - €10.2M Pre-seed for AI autopilot for supply chains.</p>
            <a href="https://www.parloa.com/careers/?utm_source=handpickedberlin">Parloa</a>
            <a href="https://www.generalmind.com/?utm_source=handpickedberlin">GeneralMind</a>
          </main>
        </body>
      </html>
    `;

    const companies = fundedBerlinInternals.parseHandpickedArticle(source, html);

    expect(companies).toHaveLength(2);
    expect(companies[0]?.name).toBe("Parloa");
    expect(companies[0]?.website).toContain("parloa.com");
    expect(companies[1]?.stageText).toBe("pre-seed");
  });

  it("parses vc portfolio links into startup candidates", () => {
    const source: FundedStartupSource = {
      name: "Project A Portfolio",
      provider: "vc_portfolio",
      url: "https://www.project-a.vc/companies/",
      maxCompanies: 10,
    };
    const html = `
      <html>
        <body>
          <h2>Atmen</h2>
          <a href="https://www.atmen.co/">https://www.atmen.co/</a>
          <h2>Bucket</h2>
          <a href="https://bucket.co/">https://bucket.co/</a>
        </body>
      </html>
    `;

    const companies = fundedBerlinInternals.parseVcPortfolio(source, html);

    expect(companies).toHaveLength(2);
    expect(companies[0]?.name.toLowerCase()).toContain("atmen");
    expect(companies[0]?.stageText).toBe("funded");
  });
});
