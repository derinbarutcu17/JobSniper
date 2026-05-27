import { describe, expect, it } from "vitest";
import { classifyLanguage, classifyLocation, classifyRole } from "../src/daily/classification.js";

describe("daily classification", () => {
  it("accepts target design roles", () => {
    expect(classifyRole("Product Designer").accepted).toBe(true);
    expect(classifyRole("Design Engineer").accepted).toBe(true);
    expect(classifyRole("UX/UI Designer").accepted).toBe(true);
  });

  it("accepts frontend roles only when UI-heavy", () => {
    expect(classifyRole("Frontend Engineer", "React, Figma, component library, visual polish").accepted).toBe(true);
    expect(classifyRole("Frontend Engineer", "Microservices, Kubernetes, backend ownership").accepted).toBe(false);
  });

  it("rejects senior and off-profile roles", () => {
    expect(classifyRole("Senior Product Designer").accepted).toBe(false);
    expect(classifyRole("Backend Engineer").accepted).toBe(false);
    expect(classifyRole("ML Engineer").accepted).toBe(false);
  });

  it("keeps startup lead and head roles but rejects corporate leadership", () => {
    expect(classifyRole("Lead Designer", "Hands-on startup role for a small team").accepted).toBe(true);
    expect(classifyRole("Head of Design", "First designer at a seed startup, hands-on").accepted).toBe(true);
    expect(classifyRole("Director of Design", "Corporate design org").accepted).toBe(false);
  });

  it("applies geography rules", () => {
    expect(classifyLocation("Berlin", "onsite").accepted).toBe(true);
    expect(classifyLocation("Berlin", "hybrid").accepted).toBe(true);
    expect(classifyLocation("Germany", "remote").accepted).toBe(true);
    expect(classifyLocation("Europe", "remote").score).toBeLessThan(70);
    expect(classifyLocation("Worldwide", "remote").score).toBeLessThan(50);
    expect(classifyLocation("Turkey", "remote").accepted).toBe(false);
    expect(classifyLocation("New York", "onsite").accepted).toBe(false);
  });

  it("applies language rules", () => {
    expect(classifyLanguage("English working language").score).toBeGreaterThanOrEqual(85);
    expect(classifyLanguage("German", "German-language product design role").accepted).toBe(true);
    expect(classifyLanguage("German", "C1 German required").accepted).toBe(false);
    expect(classifyLanguage("German", "native German speaker").accepted).toBe(false);
    expect(classifyLanguage("English", "German nice to have").accepted).toBe(true);
  });
});
