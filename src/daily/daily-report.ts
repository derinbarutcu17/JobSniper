import fs from "node:fs";
import { resolveReportPath } from "../lib/paths.js";
import type { DailyReportPayload } from "./daily-types.js";

function renderJob(item: DailyReportPayload["jobs"][number]): string {
  return [
    `### ${item.rank}. ${item.company} — ${item.title}`,
    `- Confidence: ${item.confidence} (${item.confidenceLabel})`,
    `- Status: ${item.state}`,
    `- Location: ${item.location || "Unknown"}`,
    `- Language note: ${item.languageNote || "None"}`,
    `- Apply URL: ${item.applyUrl || item.jobUrl || "Missing"}`,
    `- Source: ${item.source || "unknown"}`,
    `- Why it fits: ${item.whyFit}`,
    `- Warnings: ${item.warnings.join("; ") || "None"}`,
  ].join("\n");
}

function renderCompany(item: DailyReportPayload["companies"][number]): string {
  return [
    `### ${item.rank}. ${item.company}`,
    `- Confidence: ${item.confidence} (${item.confidenceLabel})`,
    `- Status: ${item.state}`,
    `- Website: ${item.website}`,
    `- Contact route: ${item.contactRoute}`,
    `- Contact type: ${item.contactType}`,
    `- Source: ${item.source || "unknown"}`,
    `- Why it fits: ${item.whyFit}`,
    `- Warnings: ${item.warnings.join("; ") || "None"}`,
  ].join("\n");
}

export function buildDailyReportPaths(baseDir: string, generatedAt: string): { markdownPath: string; jsonPath: string } {
  const stamp = generatedAt.slice(0, 19).replace("T", "-").replace(/:/g, "-");
  return {
    markdownPath: resolveReportPath(baseDir, `${stamp}-daily.md`),
    jsonPath: resolveReportPath(baseDir, `${stamp}-daily.json`),
  };
}

export function renderDailyMarkdown(payload: DailyReportPayload): string {
  const lines: string[] = [];
  lines.push(`# Job Sniper Daily Report — ${payload.generatedAt.slice(0, 10)}`);
  lines.push("");
  lines.push(`Mode: ${payload.mode}`);
  lines.push(`Profile cache status: ${payload.profileCache.refreshed ? "refreshed" : payload.profileCache.usedCache ? "cached" : payload.profileCache.staleFallback ? "stale fallback" : "config fallback"}`);
  lines.push(`Gmail audit status: ${payload.gmailAudit.fileFound ? `loaded (${payload.gmailAudit.importedSignals} signals)` : "not found"}`);
  lines.push(`Sheets sync status: ${payload.sheets.skipped ? "skipped" : payload.sheets.ok ? "synced" : "failed"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(`- Jobs recommended: ${payload.summary.jobsRecommended}`);
  lines.push(`- Companies recommended: ${payload.summary.companiesRecommended}`);
  lines.push(`- Already applied skipped: ${payload.summary.alreadyAppliedSkipped}`);
  lines.push(`- Already contacted skipped: ${payload.summary.alreadyContactedSkipped}`);
  lines.push(`- Duplicates removed: ${payload.summary.duplicatesRemoved}`);
  lines.push(`- Auto-deep triggered: ${payload.summary.autoDeepTriggered ? "yes" : "no"}`);
  lines.push("");
  lines.push("## Jobs to Apply To");
  if (payload.jobs.length === 0) {
    lines.push("- No new jobs met the threshold.");
  } else {
    for (const job of payload.jobs) {
      lines.push(renderJob(job));
      lines.push("");
    }
  }
  lines.push("## Companies to Cold Email");
  if (payload.companies.length === 0) {
    lines.push("- No new companies met the threshold.");
  } else {
    for (const company of payload.companies) {
      lines.push(renderCompany(company));
      lines.push("");
    }
  }
  lines.push("## Skipped / Deduped");
  if (payload.skipped.length === 0) {
    lines.push("- Nothing notable was skipped.");
  } else {
    for (const item of payload.skipped) {
      lines.push(`- ${item.label}: ${item.reason} — ${item.details}`);
    }
  }
  return lines.join("\n").trimEnd();
}

export function writeDailyMarkdown(markdownPath: string, markdown: string): void {
  fs.writeFileSync(markdownPath, `${markdown}\n`);
}
