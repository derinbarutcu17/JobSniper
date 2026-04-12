import { describe, expect, it } from "vitest";
import { discoverFromAtsBoard, expandSearchResult } from "../src/search/ats.js";
import { canonicalJobKey } from "../src/lib/url.js";
import { discoverFromRss } from "../src/search/rss.js";
import { classifyCandidate, classifyPageType } from "../src/search/classify.js";
import { buildPageRecord, extractContacts } from "../src/search/extract.js";
import { fixture, makeFetchStub } from "./helpers.js";

describe("parsers", () => {
  it("parses RSS feed entries", async () => {
    const deps = makeFetchStub({
      "https://feed.example.com/rss": { body: fixture("sample-rss.xml") },
    });
    const listings = await discoverFromRss(
      { name: "Sample Design Feed", url: "https://feed.example.com/rss" },
      deps,
    );
    expect(listings).toHaveLength(1);
    expect(listings[0]?.title).toBe("Product Designer");
    expect(listings[0]?.company).toBe("ModaAI");
  });

  it("parses Berlin job JSON-LD and extracts public contacts", async () => {
    const deps = makeFetchStub({
      "https://jobs.example.com/turkish-design-role": { body: fixture("turkish-job.html") },
    });
    const listings = await expandSearchResult(
      {
        lane: "design_jobs",
        title: "UI/UX Designer",
        url: "https://jobs.example.com/turkish-design-role",
        snippet: "Berlin hybrid product design role.",
        source: "search",
        query: "ui ux berlin",
        provider: "duckduckgo",
      },
      deps,
    );
    expect(listings[0]?.company).toBe("Berlin Studio");
    expect(listings[0]?.language).toBe("en");
    expect(listings[0]?.publicContacts.some((contact) => contact.email === "hello@berlinstudio.com")).toBe(true);
  });

  it("normalizes canonical job keys from tracking URLs", () => {
    const keyA = canonicalJobKey(
      "https://jobs.example.com/agent-engineer?utm_source=x",
      "",
      "Agent Engineer",
      "Agent Forge",
    );
    const keyB = canonicalJobKey(
      "https://jobs.example.com/agent-engineer?utm_source=y",
      "",
      "Agent Engineer",
      "Agent Forge",
    );
    expect(keyA).toBe(keyB);
  });

  it("classifies real job detail pages ahead of career hubs", () => {
    expect(classifyPageType("https://example.com/jobs/123", "Apply now employment type valid through")).toBe("job_detail");
    expect(classifyCandidate({
      url: "https://example.com/blog/hiring-lessons",
      normalizedUrl: "https://example.com/blog/hiring-lessons",
      sourceType: "search",
      lane: "design_jobs",
      intent: "unknown",
      query: "",
      confidence: 0.3,
      source: "test",
      discoveredAt: new Date().toISOString(),
      domain: "example.com",
      title: "Hiring Lessons",
      snippet: "We are hiring designers",
    }).intent).toBe("job");
  });

  it("extracts only valid email addresses from messy HTML", () => {
    const page = buildPageRecord(
      "https://example.com/contact",
      `
        <html><body>
          <a href="mailto:jobs@example.com">Apply via email</a>
          <a href="mailto:jobs@company.org?subject=Apply">Apply via email</a>
          <a href="mailto:press@company.org">Press</a>
          <a href="mailto:name@company.com">Placeholder</a>
          <a href="mailto:do-not-reply@company.org">Ignore</a>
          <p>Reach recruiter@company.org for hiring.</p>
          <p>Asset playlist-cover-bg_small@2x-c437aa7f.png should not be treated like an email.</p>
        </body></html>
      `,
      "test",
      "page",
    );
    const contacts = extractContacts(page);
    expect(contacts.some((contact) => contact.email === "jobs@company.org")).toBe(true);
    expect(contacts.some((contact) => contact.email === "press@company.org")).toBe(true);
    expect(contacts.some((contact) => contact.email === "recruiter@company.org")).toBe(true);
    expect(contacts.some((contact) => contact.email === "name@company.com")).toBe(false);
    expect(contacts.some((contact) => contact.email === "do-not-reply@company.org")).toBe(false);
    expect(contacts.some((contact) => contact.email?.includes("?subject"))).toBe(false);
    expect(
      contacts.some(
        (contact) => Boolean(contact.email) && !/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(contact.email),
      ),
    ).toBe(false);
  });

  it("falls back to search results when Wellfound board is blocked by a challenge page", async () => {
    const deps = makeFetchStub({
      "https://wellfound.com/location/berlin-berlin": {
        body: "<html><body><iframe title='DataDome CAPTCHA' src='https://geo.captcha-delivery.com/captcha/'></iframe></body></html>",
      },
      "https://html.duckduckgo.com/html/?q=site%3Awellfound.com%2Fjobs%20%22product%20designer%22%20%22Berlin%22": {
        body: fixture("wellfound-search-results.html"),
      },
    });
    const listings = await discoverFromAtsBoard(
      {
        name: "Wellfound Design Jobs",
        provider: "wellfound",
        url: "https://wellfound.com/location/berlin-berlin",
        lane: "design_jobs",
      },
      deps,
    );
    expect(listings.length).toBeGreaterThan(0);
    expect(listings[0]?.source).toBe("Wellfound search fallback");
    expect(listings[0]?.url).toContain("wellfound.com");
  });

  it("uses sparse search fallback snippets and degrades Wellfound company pages honestly", async () => {
    const deps = makeFetchStub({
      "https://wellfound.com/location/berlin-berlin": {
        body: "<html><body><iframe title='DataDome CAPTCHA' src='https://geo.captcha-delivery.com/captcha/'></iframe></body></html>",
      },
      "https://html.duckduckgo.com/html/?q=site%3Awellfound.com%2Fjobs%20%22ai%20engineer%22%20%22Berlin%22": {
        body: `
          <html><body>
            <div class="result">
              <div class="result__title">
                <a class="result__a" href="https://wellfound.com/company/agent-forge">Agent Forge | Wellfound</a>
              </div>
              <div class="meta">Berlin AI startup hiring product and engineering talent.</div>
            </div>
          </body></html>
        `,
      },
      "https://html.duckduckgo.com/html/?q=site%3Awellfound.com%2Fjobs%20%22ai%20engineer%22%20Germany": {
        body: `
          <html><body>
            <div class="result">
              <div class="result__title">
                <a class="result__a" href="https://wellfound.com/company/agent-forge">Agent Forge | Wellfound</a>
              </div>
              <div class="meta">Berlin AI startup hiring product and engineering talent.</div>
            </div>
          </body></html>
        `,
      },
    });
    const listings = await discoverFromAtsBoard(
      {
        name: "Wellfound AI Jobs",
        provider: "wellfound",
        url: "https://wellfound.com/location/berlin-berlin",
        lane: "ai_coding_jobs",
      },
      deps,
    );
    expect(listings).toHaveLength(1);
    expect(listings[0]?.description).toContain("Berlin AI startup hiring");
    expect(listings[0]?.isRealJobPage).toBe(false);
    expect(listings[0]?.parseConfidence).toBeLessThan(0.35);
  });

  it("filters weak generic career-hub child pages instead of turning them into listings", async () => {
    const deps = makeFetchStub({
      "https://company.example.com/careers": {
        body: `
          <html><body>
            <a href="/jobs/design-engineer">Design Engineer</a>
            <a href="/culture">Culture</a>
          </body></html>
        `,
      },
      "https://company.example.com/jobs/design-engineer": {
        body: `
          <html><head><title>Design Engineer</title></head>
          <body>
            <h1>Design Engineer</h1>
            <p>Berlin hybrid role. Apply now. Employment type: full-time.</p>
          </body></html>
        `,
      },
      "https://company.example.com/culture": {
        body: `
          <html><head><title>Culture</title></head>
          <body>
            <h1>How we work</h1>
            <p>We value collaboration and shipping.</p>
          </body></html>
        `,
      },
    });
    const listings = await discoverFromAtsBoard(
      {
        name: "Generic Board",
        provider: "generic",
        url: "https://company.example.com/careers",
        lane: "design_jobs",
      },
      deps,
    );
    expect(listings).toHaveLength(1);
    expect(listings[0]?.title).toBe("Design Engineer");
    expect(listings[0]?.isRealJobPage).toBe(true);
  });

  it("keeps career-hub expansion on the same domain instead of following external job links", async () => {
    const deps = makeFetchStub({
      "https://company.example.com/careers": {
        body: `
          <html><body>
            <a href="https://jobs.otherboard.com/design-engineer">Apply on Partner ATS</a>
            <a href="/jobs/product-designer">Product Designer</a>
          </body></html>
        `,
      },
      "https://company.example.com/jobs/product-designer": {
        body: `
          <html><head><title>Product Designer</title></head>
          <body>
            <h1>Product Designer</h1>
            <p>Berlin hybrid role. Apply now.</p>
          </body></html>
        `,
      },
    });
    const listings = await discoverFromAtsBoard(
      {
        name: "Generic Board",
        provider: "generic",
        url: "https://company.example.com/careers",
        lane: "design_jobs",
      },
      deps,
    );
    expect(listings).toHaveLength(1);
    expect(listings[0]?.url).toBe("https://company.example.com/jobs/product-designer");
  });

  it("ranks strong Wellfound job fallback results ahead of vague company or press-style noise", async () => {
    const deps = makeFetchStub({
      "https://wellfound.com/location/berlin-berlin": {
        body: "<html><body><iframe title='DataDome CAPTCHA' src='https://geo.captcha-delivery.com/captcha/'></iframe></body></html>",
      },
      "https://html.duckduckgo.com/html/?q=site%3Awellfound.com%2Fjobs%20%22product%20designer%22%20%22Berlin%22": {
        body: `
          <html><body>
            <div class="result">
              <div class="result__title">
                <a class="result__a" href="https://wellfound.com/company/noisy-labs">Noisy Labs | Wellfound</a>
              </div>
              <div class="result__snippet">Startup profile and company overview.</div>
            </div>
            <div class="result">
              <div class="result__title">
                <a class="result__a" href="https://wellfound.com/jobs/555-product-designer-at-signal-canvas">Product Designer at Signal Canvas | Wellfound</a>
              </div>
              <div class="result__snippet">Berlin hybrid product designer role working across Figma and design systems.</div>
            </div>
            <div class="result">
              <div class="result__title">
                <a class="result__a" href="https://wellfound.com/company/noisy-labs/funding">Noisy Labs raises Series A | Wellfound</a>
              </div>
              <div class="result__snippet">Latest funding news.</div>
            </div>
          </body></html>
        `,
      },
      "https://html.duckduckgo.com/html/?q=site%3Awellfound.com%2Fjobs%20%22product%20designer%22%20Germany": {
        body: "<html><body></body></html>",
      },
    });
    const listings = await discoverFromAtsBoard(
      {
        name: "Wellfound Design Jobs",
        provider: "wellfound",
        url: "https://wellfound.com/location/berlin-berlin",
        lane: "design_jobs",
      },
      deps,
    );
    expect(listings.length).toBeGreaterThan(0);
    expect(listings[0]?.url).toContain("/jobs/");
    expect(listings[0]?.isRealJobPage).toBe(true);
    expect(listings[0]?.title).toContain("Product Designer");
  });
});
