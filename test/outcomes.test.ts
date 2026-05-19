import { describe, expect, it } from "vitest";
import { summarizeExperiments } from "../src/state/experiments.js";
import { openDatabase } from "../src/state/db.js";
import { logContactAttempt, logOutcome } from "../src/state/contact-log.js";
import { makeTempDir } from "./helpers.js";

describe("outcome logging", () => {
  it("stores contact attempts and summarizes outcomes by route", () => {
    const baseDir = makeTempDir();
    const { db } = openDatabase(baseDir);
    db.exec(`
      INSERT INTO companies (canonical_key, name, created_at, updated_at) VALUES ('company:north', 'North', datetime('now'), datetime('now'));
      INSERT INTO jobs (
        canonical_key, company_id, company_name, title, recommended_route, pitch_theme, created_at, updated_at
      ) VALUES (
        'job:north-1', 1, 'North', 'Design Engineer', 'direct_email_first', 'design_engineering', datetime('now'), datetime('now')
      );
    `);

    logContactAttempt(db, "company:north", "email", "sent intro", 1);
    logOutcome(db, "company:north", "reply", "got a reply", 1);

    const summary = summarizeExperiments(db);
    expect(summary.replyRateByRoute.direct_email_first).toBe(1);
    expect(summary.topPitchThemes[0]?.pitchTheme).toBe("design_engineering");
  });
});
