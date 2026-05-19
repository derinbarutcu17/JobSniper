import { describe, expect, it } from "vitest";
import { buildCompanyDecisionSnapshot, renderCompanyDossier } from "../src/presentation/company-dossier.js";

describe("company dossier", () => {
  it("summarizes route, priority, and roles", () => {
    const output = renderCompanyDossier(
      {
        id: 1,
        name: "North",
        startup_score: 12,
        company_fit_score: 8,
        contactability_score: 10,
        open_role_count: 2,
        team_url: "https://north.example.com/team",
      },
      [{ title: "Design Engineer", recommendation: "cold_email", pitch_theme: "design_engineering", pitch_angle: "Lead with hybrid design and code." }],
      [{ email: "hello@north.example.com" }],
    );
    expect(output).toContain("Recommendation:");
    expect(output).toContain("Best route:");
    expect(output).toContain("Design Engineer");
  });

  it("prefers the strongest tracked role instead of insertion order", () => {
    const output = renderCompanyDossier(
      {
        id: 1,
        name: "North",
        startup_score: 12,
        company_fit_score: 8,
        contactability_score: 10,
        open_role_count: 2,
        team_url: "https://north.example.com/team",
      },
      [
        { title: "Company Watch Stub", recommendation: "watch", pitch_theme: "startup_speed", pitch_angle: "Generic monitoring angle.", score: 20 },
        { title: "AI Product Engineer", recommendation: "cold_email", pitch_theme: "ai_workflows", pitch_angle: "Lead with AI workflow leverage.", score: 78 },
      ],
      [{ email: "hello@north.example.com" }],
    );
    expect(output).toContain("Pitch theme: ai_workflows");
    expect(output).toContain("AI Product Engineer (cold_email)");
  });

  it("does not over-promote low-signal watch-only companies", () => {
    const snapshot = buildCompanyDecisionSnapshot(
      {
        id: 1,
        name: "Quiet Co",
        startup_score: 8,
        company_fit_score: 4,
        contactability_score: 0,
        open_role_count: 0,
        team_url: "",
        about_url: "",
      },
      [],
      0,
    );
    expect(snapshot.recommendation).toBe("watch");
    expect(snapshot.bestRoute).toBe("watch_company");
  });
});
