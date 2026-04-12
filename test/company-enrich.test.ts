import { describe, expect, it } from "vitest";
import { enrichCompanyFromWeb, resolveCompanyBestContact } from "../src/company-enrich.js";
import { makeFetchStub } from "./helpers.js";

describe("company enrichment", () => {
  it("does not mistake blog slugs containing contact words for the company contact page", async () => {
    const deps = makeFetchStub({
      "https://synthflow.ai": {
        body: `
          <html><body>
            <a href="/contact">Contact</a>
            <a href="/blog/contact-center-automation">Blog</a>
          </body></html>
        `,
      },
      "https://synthflow.ai/": {
        body: `
          <html><body>
            <a href="/contact">Contact</a>
            <a href="/blog/contact-center-automation">Blog</a>
          </body></html>
        `,
      },
      "https://synthflow.ai/contact": {
        body: `<html><body><a href="mailto:hello@synthflow.ai">Email</a></body></html>`,
      },
      "https://synthflow.ai/blog/contact-center-automation": {
        body: `<html><body><p>AI contact center automation article.</p></body></html>`,
      },
      "https://synthflow.ai/team": {
        body: `<html><body></body></html>`,
        status: 404,
      },
      "https://synthflow.ai/about": {
        body: `<html><body></body></html>`,
        status: 404,
      },
      "https://synthflow.ai/careers": {
        body: `<html><body></body></html>`,
        status: 404,
      },
      "https://synthflow.ai/jobs": {
        body: `<html><body></body></html>`,
        status: 404,
      },
      "https://synthflow.ai/imprint": {
        body: `<html><body></body></html>`,
        status: 404,
      },
    });

    const result = await enrichCompanyFromWeb(
      {
        canonical_key: "company:synthflow",
        name: "SynthFlow AI",
        domain: "synthflow.ai",
        company_url: "https://synthflow.ai",
        contact_url: "https://synthflow.ai/blog/contact-center-automation",
        public_contacts: "[]",
        source_urls: "[]",
      },
      deps,
    );

    expect(result.companyInput.contactUrl).toBe("https://synthflow.ai/contact");
    expect(resolveCompanyBestContact({ ...result.companyInput, public_contacts: JSON.stringify(result.companyInput.publicContacts) })).toBe(
      "hello@synthflow.ai",
    );
  });

  it("falls back from a broken localized homepage path to the site root and infers stage text", async () => {
    const deps = makeFetchStub({
      "https://www.berlinheals.com/en": {
        body: "<html><body>missing</body></html>",
        status: 404,
      },
      "https://www.berlinheals.com/": {
        body: `
          <html><body>
            <p>Berlin early stage startup building AI healthcare workflows. Seed company. Small team.</p>
            <a href="/contact">Contact</a>
          </body></html>
        `,
      },
      "https://www.berlinheals.com/contact": {
        body: `<html><body><a href="mailto:hello@berlinheals.com">Email</a></body></html>`,
      },
      "https://www.berlinheals.com/team": { body: "<html></html>", status: 404 },
      "https://www.berlinheals.com/about": { body: "<html></html>", status: 404 },
      "https://www.berlinheals.com/careers": { body: "<html></html>", status: 404 },
      "https://www.berlinheals.com/jobs": { body: "<html></html>", status: 404 },
      "https://www.berlinheals.com/imprint": { body: "<html></html>", status: 404 },
    });

    const result = await enrichCompanyFromWeb(
      {
        canonical_key: "company:berlinheals",
        name: "Berlin Heals",
        domain: "www.berlinheals.com",
        company_url: "https://www.berlinheals.com/en",
        public_contacts: "[]",
        source_urls: "[]",
      },
      deps,
    );

    expect(result.companyInput.companyUrl).toBe("https://www.berlinheals.com/");
    expect(result.companyInput.stageText).toBe("seed");
    expect(result.companyInput.startupScore).toBeGreaterThanOrEqual(16);
  });

  it("prefers company-domain contact pages over linkedin fallback when homepage is blocked", async () => {
    const deps = makeFetchStub({
      "https://onefootball.com/": {
        body: "<html><body>blocked</body></html>",
        status: 429,
      },
      "https://html.duckduckgo.com/html/?q=site%3Aonefootball.com%20OneFootball%20contact": {
        body: `
          <div class="result">
            <a class="result__a" href="https://www.linkedin.com/company/onefootball/">OneFootball LinkedIn</a>
            <div class="result__snippet">Company profile</div>
          </div>
          <div class="result">
            <a class="result__a" href="https://onefootball.com/contact">OneFootball Contact</a>
            <div class="result__snippet">Get in touch with the Berlin team</div>
          </div>
        `,
      },
      "https://onefootball.com/contact": {
        body: `<html><body><a href="mailto:hello@onefootball.com">Email</a></body></html>`,
      },
      "https://search.brave.com/search?q=site%3Aonefootball.com%20OneFootball%20contact&source=web": {
        body: "<html><body></body></html>",
      },
    });

    const result = await enrichCompanyFromWeb(
      {
        canonical_key: "company:onefootball",
        name: "OneFootball",
        domain: "onefootball.com",
        company_url: "https://onefootball.com/",
        public_contacts: "[]",
        source_urls: "[]",
      },
      deps,
    );

    expect(result.companyInput.companyUrl).toBe("https://onefootball.com/contact");
    expect(result.companyInput.contactUrl).toBe("https://onefootball.com/contact");
    expect(resolveCompanyBestContact({ ...result.companyInput, public_contacts: JSON.stringify(result.companyInput.publicContacts) })).toBe(
      "hello@onefootball.com",
    );
  });

  it("does not let seeded startup-list labels or weak vendor emails dominate enrichment", async () => {
    const deps = makeFetchStub({
      "https://example.ai": {
        body: `
          <html><body>
            <p>Workflow platform for operations teams in Berlin.</p>
            <a href="mailto:support@vendor.com">Support</a>
            <a href="mailto:hello@example.ai">Hello</a>
          </body></html>
        `,
      },
      "https://example.ai/": {
        body: `
          <html><body>
            <p>Workflow platform for operations teams in Berlin.</p>
            <a href="mailto:support@vendor.com">Support</a>
            <a href="mailto:hello@example.ai">Hello</a>
          </body></html>
        `,
      },
      "https://example.ai/contact": { body: "<html><body></body></html>", status: 404 },
      "https://example.ai/team": { body: "<html><body></body></html>", status: 404 },
      "https://example.ai/about": { body: "<html><body></body></html>", status: 404 },
      "https://example.ai/careers": { body: "<html><body></body></html>", status: 404 },
      "https://example.ai/jobs": { body: "<html><body></body></html>", status: 404 },
      "https://example.ai/imprint": { body: "<html><body></body></html>", status: 404 },
    });

    const result = await enrichCompanyFromWeb(
      {
        canonical_key: "company:example",
        name: "Example",
        domain: "example.ai",
        company_url: "https://example.ai",
        public_contacts: JSON.stringify(["support@vendor.com", "hello@example.ai"]),
        source_urls: "[]",
        stage_text: "Berlin startup list",
        startup_score: 14,
      },
      deps,
    );

    expect(resolveCompanyBestContact({ ...result.companyInput, public_contacts: JSON.stringify(result.companyInput.publicContacts) })).toBe(
      "hello@example.ai",
    );
    expect(result.companyInput.stageText).toBe("");
    expect(result.companyInput.startupScore).toBeLessThanOrEqual(8);
  });
});
