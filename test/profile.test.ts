import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deriveProfileSummary, onboardProfile } from "../src/profile.js";
import { makeTempDir } from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("profile seniority parsing", () => {
  it("treats explicit no-senior wording as junior target", () => {
    const profile = deriveProfileSummary(
      "Berlin based designer. No Senior/Lead roles. Looking for junior or associate product design opportunities.",
    );
    expect(profile.targetSeniority).toBe("junior");
    expect(profile.allowStretchRoles).toBe(false);
    expect(profile.avoidTitleTerms).toContain("senior");
  });

  it("recognizes leadership and years as senior", () => {
    const profile = deriveProfileSummary(
      "5+ years leading teams across product and engineering. Lead engineer focused on AI product delivery.",
    );
    expect(profile.targetSeniority).toBe("senior");
    expect(profile.allowStretchRoles).toBe(true);
  });

  it("rejects missing profile file paths instead of storing them as CV text", async () => {
    const baseDir = makeTempDir();
    await expect(onboardProfile(baseDir, "/no/such/file.pdf")).rejects.toThrow("Profile file was not found");
    expect(fs.existsSync(path.join(baseDir, "profile", "cv.md"))).toBe(false);
  });

  it("can onboard from a profile URL", async () => {
    const baseDir = makeTempDir();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          `
            <html>
              <head>
                <title>Derin Portfolio</title>
                <meta name="description" content="Berlin product designer and frontend builder" />
              </head>
              <body>
                <main>Design systems, React, TypeScript, AI workflows, Berlin.</main>
              </body>
            </html>
          `,
          { status: 200, headers: { "content-type": "text/html" } },
        ),
      ),
    );

    const result = await onboardProfile(baseDir, "https://example.com/portfolio");
    expect(result.profile.toolSignals).toContain("react");
    expect(result.profile.preferredLocations).toContain("Berlin");
    expect(fs.readFileSync(path.join(baseDir, "profile", "cv.md"), "utf8")).toContain("Derin Portfolio");
  });
});
