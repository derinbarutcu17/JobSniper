import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { makeTempDir } from "./helpers.js";

describe("config validation", () => {
  it("rejects enabled lanes with no queries or keywords", () => {
    const baseDir = makeTempDir();
    fs.writeFileSync(
      path.join(baseDir, "config.json"),
      JSON.stringify(
        {
          lanes: {
            empty_lane: {
              label: "Empty",
              type: "job",
              enabled: true,
              queries: { en: [], tr: [] },
              keywords: [],
              queryTerms: [],
              profileSignals: [],
              titleFamilies: [],
              mismatchTerms: [],
              startupTerms: [],
              companyTerms: [],
            },
          },
        },
        null,
        2,
      ),
    );

    expect(() => loadConfig(baseDir)).toThrow('Lane "empty_lane" is enabled but has no queries or keywords.');
  });

  it("rejects ATS boards that reference unknown lanes", () => {
    const baseDir = makeTempDir();
    fs.writeFileSync(
      path.join(baseDir, "config.json"),
      JSON.stringify(
        {
          sources: {
            atsBoards: [
              {
                name: "Ghost Board",
                provider: "greenhouse",
                url: "https://boards.greenhouse.io/ghost",
                lane: "ghost_lane",
              },
            ],
          },
        },
        null,
        2,
      ),
    );

    expect(() => loadConfig(baseDir)).toThrow('ATS source "Ghost Board" references unknown lane "ghost_lane".');
  });
});
