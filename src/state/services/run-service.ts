import { loadConfig } from "../../normalization/config.js";
import { openDatabase, startRunRecord, finishRunRecord } from "../db.js";
import { toSniperError } from "../../errors.js";
import { loadProfile } from "../../normalization/profile.js";
import type { Dependencies, PipelineContext, RunRequest, RunResult, RunStatus } from "../../types.js";
import { createDiscoveryService } from "./discovery-service.js";

export interface RunService {
  run(request?: RunRequest): Promise<RunResult>;
}

export function createRunService(baseDir: string, deps: Dependencies): RunService {
  const discoveryService = createDiscoveryService(baseDir, deps);
  return {
    async run(request = {}) {
      const { db } = openDatabase(baseDir);
      const config = loadConfig(baseDir);
      const { profile } = loadProfile(baseDir);
      const runId = startRunRecord(db, {
        lane: request.lane ?? "",
        mode: request.companyWatchOnly ? "company_watch_only" : request.lane ? "lane" : "full",
      });
      const context: PipelineContext = {
        runId,
        lane: request.lane,
        companyWatchOnly: request.companyWatchOnly,
        configSnapshot: config,
        profileSnapshot: profile,
        sourceBreakdown: {},
        warnings: [],
        errors: [],
      };

      try {
        const summary = await discoveryService.run(request, context);
        const status: RunStatus = context.errors.length ? "partial" : "succeeded";
        const run = finishRunRecord(db, runId, {
          status,
          sourceBreakdown: context.sourceBreakdown,
          warnings: context.warnings,
          errors: context.errors,
          artifacts: [],
          summary,
        });
        return { run, summary: { ...summary, runId, status, warnings: context.warnings, errors: context.errors } };
      } catch (error) {
        const sniperError = toSniperError(error, "runtime_error");
        const run = finishRunRecord(db, runId, {
          status: "failed",
          sourceBreakdown: context.sourceBreakdown,
          warnings: context.warnings,
          errors: [...context.errors, sniperError.message],
          artifacts: [],
          summary: {
            runId,
            status: "failed",
            totalFound: 0,
            totalNew: 0,
            totalUpdated: 0,
            excluded: 0,
            companiesTouched: 0,
            contactsTouched: 0,
            deduped: 0,
            parsed: 0,
            fetchSuccessRate: 0,
            parseSuccessRate: 0,
            jsFallbackRate: 0,
            warnings: context.warnings,
            errors: [...context.errors, sniperError.message],
          },
        });
        throw Object.assign(sniperError, { run });
      }
    },
  };
}
