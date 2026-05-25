import { getLatestRun, openDatabase } from "../db.js";
import type { StatsSnapshot } from "../../types.js";

export interface StatsService {
  get(): StatsSnapshot;
}

export function createStatsService(baseDir: string): StatsService {
  return {
    get() {
      const { db } = openDatabase(baseDir);
      const counts = db
        .prepare(`
          SELECT
            (SELECT COUNT(*) FROM jobs) AS jobs,
            (SELECT COUNT(*) FROM jobs WHERE eligibility = 'eligible' AND status != 'excluded') AS eligible_jobs,
            (SELECT COUNT(*) FROM companies) AS companies,
            (SELECT COUNT(*) FROM contacts) AS contacts
        `)
        .get() as { jobs: number; eligible_jobs: number; companies: number; contacts: number };
      const strategic = db.prepare(`
        SELECT
          SUM(CASE WHEN recommendation IN ('apply_now','cold_email','enrich_first') THEN 1 ELSE 0 END) AS actionable,
          SUM(CASE WHEN recommendation = 'apply_now' THEN 1 ELSE 0 END) AS apply_now,
          SUM(CASE WHEN recommendation = 'cold_email' THEN 1 ELSE 0 END) AS cold_email,
          SUM(CASE WHEN recommendation = 'enrich_first' THEN 1 ELSE 0 END) AS enrich_first,
          SUM(CASE WHEN recommendation = 'watch' THEN 1 ELSE 0 END) AS watch_count,
          SUM(CASE WHEN recommendation = 'discard' THEN 1 ELSE 0 END) AS discard_count,
          AVG(outreach_leverage_score) AS avg_leverage
        FROM jobs
      `).get() as Record<string, unknown>;
      const companyOutreach = db.prepare(`
        SELECT
          SUM(CASE WHEN status = 'reached' THEN 1 ELSE 0 END) AS reached,
          SUM(CASE WHEN status = 'sent_email' THEN 1 ELSE 0 END) AS sent_email,
          SUM(CASE WHEN status = 'talking' THEN 1 ELSE 0 END) AS talking,
          SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
          SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived
        FROM company_outreach_state
      `).get() as Record<string, unknown>;
      const jobPipeline = db.prepare(`
        SELECT
          SUM(CASE WHEN pipeline_status = 'applied' THEN 1 ELSE 0 END) AS applied,
          SUM(CASE WHEN pipeline_status = 'contacted' THEN 1 ELSE 0 END) AS contacted,
          SUM(CASE WHEN pipeline_status = 'reply_received' THEN 1 ELSE 0 END) AS reply_received,
          SUM(CASE WHEN pipeline_status = 'interviewing' THEN 1 ELSE 0 END) AS interviewing
        FROM jobs
      `).get() as Record<string, unknown>;
      const latestRun = getLatestRun(db);
      return {
        jobs: { total: counts.jobs, eligible: counts.eligible_jobs },
        companies: counts.companies,
        contacts: counts.contacts,
        outreach: {
          reached: Number(companyOutreach.reached ?? 0),
          sentEmail: Number(companyOutreach.sent_email ?? 0),
          talking: Number(companyOutreach.talking ?? 0),
          rejected: Number(companyOutreach.rejected ?? 0),
          archived: Number(companyOutreach.archived ?? 0),
          applied: Number(jobPipeline.applied ?? 0),
          contacted: Number(jobPipeline.contacted ?? 0),
          replyReceived: Number(jobPipeline.reply_received ?? 0),
          interviewing: Number(jobPipeline.interviewing ?? 0),
        },
        strategic: {
          actionable: Number(strategic.actionable ?? 0),
          applyNow: Number(strategic.apply_now ?? 0),
          coldEmail: Number(strategic.cold_email ?? 0),
          enrichFirst: Number(strategic.enrich_first ?? 0),
          watch: Number(strategic.watch_count ?? 0),
          discard: Number(strategic.discard_count ?? 0),
          averageOutreachLeverage: Number(strategic.avg_leverage ?? 0),
        },
        latestRun: latestRun ?? null,
      };
    },
  };
}
