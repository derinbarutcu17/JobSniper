import { describe, expect, it } from "vitest";
import { canonicalContactIdentity, canonicalJobIdentity, normalizeCompanyDomain } from "../src/daily/dedupe.js";

describe("daily dedupe", () => {
  it("normalizes company domains aggressively", () => {
    expect(normalizeCompanyDomain({ domain: "Langfuse GmbH", website: "https://langfuse.com" })).toBe("langfuse.com");
    expect(normalizeCompanyDomain({ domain: "www.langfuse.com" })).toBe("langfuse.com");
    expect(normalizeCompanyDomain({ applyUrl: "https://jobs.ashbyhq.com/langfuse/123" })).toBe("langfuse");
    expect(normalizeCompanyDomain({ email: "jobs@langfuse.com" })).toBe("langfuse.com");
  });

  it("dedupes jobs from multiple sources", () => {
    const first = canonicalJobIdentity({
      companyDomain: "langfuse.com",
      companyName: "Langfuse",
      title: "Product Designer (m/f/d) - Berlin",
      applyUrl: "https://langfuse.com/jobs/1",
      source: "linkedin",
    });
    const second = canonicalJobIdentity({
      companyDomain: "langfuse.com",
      companyName: "Langfuse GmbH",
      title: "Product Designer",
      jobUrl: "https://jobs.ashbyhq.com/langfuse/abc",
      source: "ashby",
    });
    expect(first).toBe(second);
  });

  it("dedupes contacts by company and value", () => {
    expect(canonicalContactIdentity({ companyDomain: "langfuse.com", type: "email", value: "jobs@langfuse.com" })).toBe(
      canonicalContactIdentity({ companyDomain: "www.langfuse.com", type: "email", value: "jobs@langfuse.com" }),
    );
  });
});
