import { getJobById, listTopJobs, openDatabase } from "../db.js";
import { mapJobRecordToDetail, mapJobRecordToSummary } from "../mappers.js";
import type { JobDetail, JobListRequest, JobSummary, TriageItem } from "../../types.js";

export interface JobsService {
  digest(request?: JobListRequest): JobSummary[];
  shortlist(request?: JobListRequest): JobSummary[];
  triage(request?: JobListRequest): TriageItem[];
  getJob(jobId: number): JobDetail | undefined;
}

export function createJobsService(baseDir: string): JobsService {
  return {
    digest(request = {}) {
      const { db } = openDatabase(baseDir);
      return listTopJobs(db, request.limit ?? 5).map(mapJobRecordToSummary);
    },

    shortlist(request = {}) {
      const { db } = openDatabase(baseDir);
      const jobs = db
        .prepare("SELECT * FROM jobs WHERE eligibility = 'eligible' AND status != 'excluded' ORDER BY score DESC, updated_at DESC LIMIT ?")
        .all(request.limit ?? 10) as Parameters<typeof mapJobRecordToSummary>[0][];
      return jobs.map(mapJobRecordToSummary);
    },

    triage(request = {}) {
      const { db } = openDatabase(baseDir);
      const jobs = db.prepare(`
        SELECT *
        FROM jobs
        WHERE status != 'excluded'
        ORDER BY
          CASE recommendation
            WHEN 'apply_now' THEN 1
            WHEN 'cold_email' THEN 2
            WHEN 'enrich_first' THEN 3
            WHEN 'watch' THEN 4
            ELSE 5
          END ASC,
          outreach_leverage_score DESC,
          score DESC,
          updated_at DESC
        LIMIT ?
      `).all(request.limit ?? 10) as Parameters<typeof mapJobRecordToDetail>[0][];
      return jobs.map((job) => {
        const detail = mapJobRecordToDetail(job);
        return {
          ...detail,
          recommendationReason: job.recommendation_reason,
        };
      });
    },

    getJob(jobId) {
      const { db } = openDatabase(baseDir);
      const job = getJobById(db, jobId);
      return job ? mapJobRecordToDetail(job) : undefined;
    },
  };
}
