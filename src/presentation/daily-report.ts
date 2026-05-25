import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "../lib/paths.js";
import type { DailyQueueResult, DailyReport } from "../types.js";

function formatJobItem(item: DailyQueueResult["jobs"][number], index: number): string {
  const icon = item.recommendation === "apply_now" ? "[APPLY]" : item.recommendation === "cold_email" ? "[EMAIL]" : "[WATCH]";
  const newBadge = item.isNew ? " NEW" : "";
  return [
    `${index + 1}. ${icon}${newBadge} ${item.title} @ ${item.companyName}`,
    `   Score: ${Math.round(item.score)} | Route: ${item.recommendedRoute} | ${item.reason}`,
    `   ${item.url}`,
  ].join("\n");
}

function formatCompanyItem(item: DailyQueueResult["companies"][number], index: number): string {
  const newBadge = item.isNew ? " NEW" : "";
  return [
    `${index + 1}. [EMAIL]${newBadge} ${item.name} (${item.domain})`,
    `   Startup: ${Math.round(item.startupScore)} | Contact: ${Math.round(item.contactabilityScore)} | Route: ${item.bestRoute}`,
    `   Best contact: ${item.bestContact || "none"}`,
    `   ${item.url}`,
  ].join("\n");
}

export function renderDailyDigest(result: DailyQueueResult): string {
  const lines: string[] = [];
  lines.push("# Daily Job Sniper Queue");
  lines.push("");
  lines.push(`Generated: ${new Date(result.generatedAt).toLocaleString()}`);
  lines.push("");

  lines.push("## Jobs to Review / Apply");
  if (result.jobs.length === 0) {
    lines.push("_No fresh jobs matched the criteria._");
  } else {
    for (let i = 0; i < result.jobs.length; i++) {
      lines.push(formatJobItem(result.jobs[i], i));
      lines.push("");
    }
  }
  lines.push("");

  lines.push("## Companies to Cold Email");
  if (result.companies.length === 0) {
    lines.push("_No fresh companies matched the criteria._");
  } else {
    for (let i = 0; i < result.companies.length; i++) {
      lines.push(formatCompanyItem(result.companies[i], i));
      lines.push("");
    }
  }
  lines.push("");

  lines.push("## Exclusion Summary");
  lines.push(`- Already in DB (acted on): ${result.excluded.alreadyInDb}`);
  lines.push(`- Already acted on: ${result.excluded.alreadyActedOn}`);
  lines.push(`- Human-excluded: ${result.excluded.humanExcluded}`);
  lines.push(`- Low score: ${result.excluded.lowScore}`);
  lines.push(`- Negative term match: ${result.excluded.negativeTermMatch}`);
  lines.push("");

  lines.push("## Query Pack Performance");
  for (const summary of result.queryPackSummary) {
    lines.push(`- ${summary.packId}: ${summary.queried} queries, ${summary.returned} returned`);
  }
  lines.push("");

  lines.push("---");
  lines.push("_Review-first: no emails were sent and no applications were submitted._");

  return lines.join("\n");
}

export function writeDailyArtifacts(
  baseDir: string,
  result: DailyQueueResult,
): DailyReport {
  const reportDir = path.join(baseDir, "data", "reports");
  const dateKey = new Date().toISOString().slice(0, 10);
  ensureDir(reportDir);

  const jsonPath = path.join(reportDir, `${dateKey}-daily-queue.json`);
  const markdownPath = path.join(reportDir, `${dateKey}-daily-queue.md`);
  const markdownDigest = renderDailyDigest(result);

  fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(markdownPath, `${markdownDigest}\n`);

  return {
    result,
    markdownDigest,
    jsonPath,
    markdownPath,
  };
}
