import { describe, expect, it } from "vitest";
import { inferRoute } from "../src/normalization/route.js";
import type { ListingCandidate } from "../src/types.js";

function listing(partial: Partial<ListingCandidate> = {}): ListingCandidate {
  return {
    lane: "design_jobs",
    externalId: "job-1",
    title: "Design Engineer",
    titleFamily: "Design Engineer",
    company: "Canvas",
    location: "Berlin",
    country: "Germany",
    language: "en",
    workModel: "remote",
    employmentType: "full-time",
    salary: "",
    description: "Seed startup looking for a design engineer.",
    url: "https://jobs.example.com/1",
    applyUrl: "",
    source: "test",
    sourceType: "page",
    sourceUrls: ["https://jobs.example.com/1"],
    companyUrl: "https://canvas.example.com",
    careersUrl: "https://canvas.example.com/careers",
    aboutUrl: "https://canvas.example.com/about",
    teamUrl: "https://canvas.example.com/team",
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
    ...partial,
  };
}

describe("route inference", () => {
  it("prefers direct email first when a startup has a public email", () => {
    const route = inferRoute(
      listing({
        publicContacts: [
          {
            kind: "careers_email",
            name: "",
            title: "",
            email: "hello@canvas.example.com",
            linkedinUrl: "",
            sourceUrl: "https://canvas.example.com",
            confidence: "high",
            evidenceType: "mailto",
            evidenceExcerpt: "",
            isPublic: true,
            pageType: "contact_page",
          },
        ],
      }),
      70,
      10,
    );
    expect(route.recommendedRoute).toBe("direct_email_first");
    expect(route.outreachLeverageScore).toBeGreaterThan(50);
  });

  it("does not treat weak inboxes as strong outreach routes", () => {
    const route = inferRoute(
      listing({
        publicContacts: [
          {
            kind: "general_contact_email",
            name: "",
            title: "",
            email: "support@canvas.example.com",
            linkedinUrl: "",
            sourceUrl: "https://canvas.example.com/contact",
            confidence: "medium",
            evidenceType: "mailto",
            evidenceExcerpt: "",
            isPublic: true,
            pageType: "contact_page",
          },
        ],
      }),
      70,
      10,
    );
    expect(route.recommendedRoute).not.toBe("direct_email_first");
    expect(route.outreachLeverageScore).toBeLessThan(50);
  });
});
