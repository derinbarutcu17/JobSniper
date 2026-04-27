import { createDefaultDependencies } from "../../lib/http.js";
import { loadConfig } from "../../normalization/config.js";
import { loadProfile } from "../../normalization/profile.js";
import { runDiscovery } from "../../ingestion/search/discovery.js";
import type { Dependencies, PipelineContext, RunRequest, RunSummary } from "../../types.js";

export interface DiscoveryService {
  run(request?: RunRequest, context?: PipelineContext): Promise<RunSummary>;
}

export function createDiscoveryService(baseDir: string, deps: Dependencies = createDefaultDependencies()): DiscoveryService {
  return {
    async run(request = {}, context) {
      const config = loadConfig(baseDir);
      const { profile } = loadProfile(baseDir);
      const pipelineContext: PipelineContext | undefined = context
        ? {
            ...context,
            configSnapshot: config,
            profileSnapshot: profile,
          }
        : undefined;
      return runDiscovery(baseDir, deps, { ...request, context: pipelineContext });
    },
  };
}
