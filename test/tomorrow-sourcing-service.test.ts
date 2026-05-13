import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createTomorrowSourcingService } from "../src/state/services/tomorrow-sourcing-service.js";

vi.mock("playwright-core", () => ({
  chromium: {
    launchPersistentContext: vi.fn(async () => {
      const page = {
        goto: vi.fn(async () => undefined),
        waitForTimeout: vi.fn(async () => undefined),
        url: () => "https://mail.google.com/mail/u/0/#sent",
        locator: () => ({
          innerText: vi.fn(async () => "No messages matched your search"),
        }),
      };
      return {
        pages: () => [page],
        newPage: async () => page,
        close: async () => undefined,
      };
    }),
  },
}));

function makeFetchResponse(body: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => ({}),
  };
}

describe("tomorrow sourcing service", () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "sniper-service-"));
  const outputPath = path.join(baseDir, "report.md");
  const jsonPath = path.join(baseDir, "report.json");
  const pdfPath = path.join(baseDir, "report.pdf");

  beforeEach(() => {
    fs.mkdirSync(path.join(baseDir, "profile"), { recursive: true });
    fs.writeFileSync(path.join(baseDir, "profile", "cv.md"), "Berlin designer using React and TypeScript.\n");
    fs.writeFileSync(
      path.join(baseDir, "profile", "profile.json"),
      JSON.stringify(
        {
          summary: "Berlin designer using React and TypeScript.",
          toolSignals: ["react", "typescript", "design"],
          preferredLocations: ["Berlin"],
          targetSeniority: "junior",
        },
        null,
        2,
      ),
    );
    fs.mkdirSync(path.join(baseDir, "data"), { recursive: true });
    fs.writeFileSync(
      path.join(baseDir, "data", "contacted-company-seed.json"),
      JSON.stringify({ companies: ["Bliq"] }, null, 2),
    );
    fs.rmSync(outputPath, { force: true });
    fs.rmSync(jsonPath, { force: true });
    fs.rmSync(pdfPath, { force: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = String(input);
        if (url.startsWith("https://html.duckduckgo.com/html/?q=")) {
          return makeFetchResponse("<html><body></body></html>");
        }
        return makeFetchResponse("<html><body></body></html>");
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a report without writing output artifacts", async () => {
    const service = createTomorrowSourcingService(baseDir);
    const result = await service.run({ outputPath, jsonPath, pdfPath });

    expect(result.text).toContain("report-only run ready");
    expect(result.text).toContain("Top 5 Applications:");
    expect(result.text).toContain("Top 5 Berlin Startups to Email:");
    expect(fs.existsSync(outputPath)).toBe(false);
    expect(fs.existsSync(jsonPath)).toBe(false);
    expect(fs.existsSync(pdfPath)).toBe(false);
  });
});
