import { generateAssetBundle } from "../assets.js";
import {
  addApplicationEvent,
  getJobById,
  getJobByUrl,
  openDatabase,
  updateJobPipelineFields,
  upsertApplication,
} from "../db.js";
import { normalizeUrl } from "../lib/url.js";
import { mapJobRecordToDetail } from "../mappers.js";
import type { ApplicationMethod, PipelineResult, PipelineStatus } from "../types.js";

export interface PipelineService {
  pipeline(input: string): PipelineResult;
  assets(jobId: number): PipelineResult;
  updateApplyState(input: { jobId: number; status: PipelineStatus; method?: ApplicationMethod; note?: string }): PipelineResult;
}

function resolveJob(baseDir: string, input: string) {
  const { db } = openDatabase(baseDir);
  const maybeId = Number(input);
  if (Number.isFinite(maybeId)) {
    return { db, job: getJobById(db, maybeId) };
  }
  const normalized = normalizeUrl(input.trim());
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    return { db, job: getJobByUrl(db, normalized) };
  }
  return { db, job: undefined };
}

function methodFromRecommendation(recommendation: string): ApplicationMethod {
  if (recommendation === "apply_now") return "ats";
  if (recommendation === "cold_email") return "direct_email";
  if (recommendation === "enrich_first") return "other";
  return "other";
}

export function createPipelineService(baseDir: string): PipelineService {
  return {
    pipeline(input) {
      const { db, job } = resolveJob(baseDir, input);
      if (!job) {
        throw new Error("pipeline expects an existing job ID or a known job URL in the local database.");
      }
      const shouldGenerateAssets = ["apply_now", "cold_email", "enrich_first"].includes(job.recommendation);
      let updatedStatus: PipelineStatus = "triaged";
      let assets: PipelineResult["assets"];
      if (shouldGenerateAssets) {
        const bundle = generateAssetBundle(baseDir, job.id);
        assets = bundle;
        updatedStatus = "asset_ready";
        updateJobPipelineFields(db, job.id, {
          pipelineStatus: "asset_ready",
          assetBundlePath: bundle.bundlePath,
          cvAssetPath: bundle.cvPath,
          coverLetterAssetPath: bundle.coverLetterPath,
          outreachNoteAssetPath: bundle.outreachNotePath,
        });
      } else {
        updateJobPipelineFields(db, job.id, { pipelineStatus: "triaged" });
      }

      const application = upsertApplication(db, {
        jobId: job.id,
        companyId: job.company_id,
        status: updatedStatus,
        method: methodFromRecommendation(job.recommendation),
        source: "pipeline",
        assetBundlePath: assets?.bundlePath ?? "",
      });
      addApplicationEvent(db, {
        applicationId: application.id,
        eventType: `pipeline:${updatedStatus}`,
        note: `Pipeline run from input: ${input}`,
      });

      const updatedJob = getJobById(db, job.id)!;
      return {
        job: mapJobRecordToDetail(updatedJob),
        assets,
        updatedStatus,
      };
    },

    assets(jobId) {
      const { db } = openDatabase(baseDir);
      const job = getJobById(db, jobId);
      if (!job) {
        throw new Error(`Job ${jobId} not found.`);
      }
      const bundle = generateAssetBundle(baseDir, job.id);
      updateJobPipelineFields(db, job.id, {
        pipelineStatus: "asset_ready",
        assetBundlePath: bundle.bundlePath,
        cvAssetPath: bundle.cvPath,
        coverLetterAssetPath: bundle.coverLetterPath,
        outreachNoteAssetPath: bundle.outreachNotePath,
      });
      const updated = getJobById(db, job.id)!;
      return {
        job: mapJobRecordToDetail(updated),
        assets: bundle,
        updatedStatus: "asset_ready",
      };
    },

    updateApplyState({ jobId, status, method, note }) {
      const { db } = openDatabase(baseDir);
      const job = getJobById(db, jobId);
      if (!job) throw new Error(`Job ${jobId} not found.`);

      const appliedAt = status === "applied" ? new Date().toISOString() : undefined;
      updateJobPipelineFields(db, jobId, {
        pipelineStatus: status,
        appliedAt,
        applicationMethod: method ?? job.application_method ?? "",
      });
      const application = upsertApplication(db, {
        jobId,
        companyId: job.company_id,
        status,
        method: method ?? (job.application_method as ApplicationMethod) ?? "other",
        submittedAt: appliedAt,
        notes: note ?? "",
        source: "manual_state_update",
        assetBundlePath: job.asset_bundle_path || "",
      });
      addApplicationEvent(db, {
        applicationId: application.id,
        eventType: `state:${status}`,
        note: note ?? "",
      });

      const updated = getJobById(db, job.id)!;
      return {
        job: mapJobRecordToDetail(updated),
        updatedStatus: status,
      };
    },
  };
}
