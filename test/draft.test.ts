import { describe, expect, it } from "vitest";
import { draftOutreach } from "../src/presentation/draft.js";
import { openDatabase } from "../src/state/db.js";
import { onboardProfile } from "../src/normalization/profile.js";
import { makeTempDir } from "./helpers.js";

describe("draft generation", () => {
  it("keeps English drafts fully English", async () => {
    const baseDir = makeTempDir();
    await onboardProfile(baseDir, "Berlin design engineer with Figma and TypeScript. Junior roles.");
    const { db } = openDatabase(baseDir);
    db.exec(`
      INSERT INTO jobs (
        canonical_key, company_name, title, language, match_rationale, relevant_projects, pitch_angle, created_at, updated_at
      ) VALUES (
        'job:test-1', 'Flux', 'AI Product Engineer', 'en', 'Strong fit', 'figma, typescript', 'Lead with design + code wedge.', datetime('now'), datetime('now')
      )
    `);

    const draft = draftOutreach(baseDir, 1);
    expect(draft).toContain("Hello Flux team,");
    expect(draft).toContain("I came across the AI Product Engineer role");
    expect(draft).not.toContain("ekibi");
    expect(draft).not.toContain("scan'imde");
    expect(draft).not.toContain("Öne çıkan");
  });
});
