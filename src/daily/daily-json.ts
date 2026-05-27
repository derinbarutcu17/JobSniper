import fs from "node:fs";
import type { DailyReportPayload } from "./daily-types.js";

export function writeDailyJson(jsonPath: string, payload: DailyReportPayload): string {
  const json = JSON.stringify(payload, null, 2);
  fs.writeFileSync(jsonPath, `${json}\n`);
  return json;
}
