import { syncSheets, pullSheets, type SheetGateway } from "../sheets.js";
import type { SheetSyncResult } from "../../types.js";

export interface SheetSyncService {
  sync(runId?: number | null, scope?: "all" | "companies_only"): Promise<SheetSyncResult>;
  pull(): Promise<{ spreadsheetId: string; pulled: number }>;
}

export function createSheetSyncService(baseDir: string, gateway?: SheetGateway): SheetSyncService {
  return {
    sync(runId, scope) {
      return syncSheets(baseDir, gateway, runId ?? undefined, scope);
    },
    pull() {
      return pullSheets(baseDir, gateway);
    },
  };
}
