import { describe, expect, it } from "vitest";
import { classifyLanguage, classifyLocation } from "../src/daily/classification.js";
import { loadCityPack, listCityPacks, loadConfig } from "../src/normalization/config.js";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

describe("city-agnostic engine", () => {
  it("lists available city packs from cities/ directory", () => {
    const packs = listCityPacks(repoRoot);
    expect(packs).toContain("berlin");
    expect(packs).toContain("london");
    expect(packs).toContain("munich");
    expect(packs).toContain("amsterdam");
    expect(packs).toContain("madrid");
  });

  it("loads a city pack by key", () => {
    const london = loadCityPack(repoRoot, "london");
    expect(london).toBeDefined();
    expect(london?.label).toBe("London");
    expect(london?.search.priorityCities).toContain("London");
    expect(london?.languageRules.preferred).toContain("en");
  });

  it("returns undefined for unknown city", () => {
    expect(loadCityPack(repoRoot, "atlantis")).toBeUndefined();
  });

  it("derives London location rules from a London config", () => {
    const originalEnv = process.env.SNIPER_CITY;
    process.env.SNIPER_CITY = "london";
    try {
      const config = loadConfig(repoRoot);
      const profile = {
        preferredLocations: ["London", "United Kingdom"],
        languagePreference: ["en"],
      };

      expect(classifyLocation("London, UK", "onsite", "", config, profile).accepted).toBe(true);
      expect(classifyLocation("United Kingdom", "remote", "", config, profile).accepted).toBe(true);
      expect(classifyLocation("Berlin", "onsite", "", config, profile).accepted).toBe(false);
      expect(classifyLocation("New York", "onsite", "", config, profile).accepted).toBe(false);
    } finally {
      if (originalEnv === undefined) delete process.env.SNIPER_CITY;
      else process.env.SNIPER_CITY = originalEnv;
    }
  });

  it("derives London language rules from profile (en only)", () => {
    const originalEnv = process.env.SNIPER_CITY;
    process.env.SNIPER_CITY = "london";
    try {
      const config = loadConfig(repoRoot);
      const profile = { preferredLocations: ["London"], languagePreference: ["en"] };

      expect(classifyLanguage("English", "English required", config, profile).accepted).toBe(false);
      expect(classifyLanguage("English", "English nice to have", config, profile).accepted).toBe(true);
    } finally {
      if (originalEnv === undefined) delete process.env.SNIPER_CITY;
      else process.env.SNIPER_CITY = originalEnv;
    }
  });

  it("rejects German requirement in a London context", () => {
    const originalEnv = process.env.SNIPER_CITY;
    process.env.SNIPER_CITY = "london";
    try {
      const config = loadConfig(repoRoot);
      const profile = { preferredLocations: ["London"], languagePreference: ["en"] };

      const result = classifyLanguage("German", "Native German required", config, profile);
      expect(result.accepted).toBe(false);
    } finally {
      if (originalEnv === undefined) delete process.env.SNIPER_CITY;
      else process.env.SNIPER_CITY = originalEnv;
    }
  });

  it("falls back to berlin defaults when no city pack matches", () => {
    const profile = { preferredLocations: [], languagePreference: ["en"] };
    expect(classifyLocation("Berlin", "onsite", "", undefined, profile).accepted).toBe(true);
  });
});
