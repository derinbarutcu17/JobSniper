import fs from "node:fs";
import path from "node:path";
import { loadConfig, saveConfig } from "../normalization/config.js";
import { enrichCompanyFromWeb } from "../ingestion/company-enrich.js";
import { logContactAttempt, logOutcome } from "../state/contact-log.js";
import {
  enqueueDiscoveryCandidates,
  getCompanyByRef,
  openDatabase,
  upsertCompany,
  upsertContact,
} from "../state/db.js";
import { draftOutreach } from "./draft.js";
import { summarizeExperiments } from "../state/experiments.js";
import { SniperError } from "../errors.js";
import { createDefaultDependencies } from "../lib/http.js";
import { domainFromUrl, normalizeUrl } from "../lib/url.js";
import { getDefaultCompanyWatchLane } from "../normalization/role-packs.js";
import { getSearchProviders } from "../ingestion/search/web.js";
import type { SheetGateway } from "../state/sheets.js";
import type { Dependencies, SearchLane } from "../types.js";
import { presentCompanies, presentContacts, presentDossier, presentJobDetail, presentJobList, presentPipelineResult, presentRunResult, presentStats, presentStatus, presentTomorrowSourcing, presentTriage } from "./presenters.js";
import { createCompaniesService } from "../state/services/companies-service.js";
import { createContactsService } from "../state/services/contacts-service.js";
import { createJobsService } from "../state/services/jobs-service.js";
import { createPipelineService } from "../state/services/pipeline-service.js";
import { createProfileService } from "../state/services/profile-service.js";
import { createRunService } from "../state/services/run-service.js";
import { createSheetSyncService } from "../state/services/sheet-sync-service.js";
import { createStatsService } from "../state/services/stats-service.js";
import { createOutreachStatusService } from "../state/services/outreach-status-service.js";
import { createTomorrowSourcingService } from "../state/services/tomorrow-sourcing-service.js";
import { runDailyQueue } from "../state/services/daily-queue-service.js";
import { writeDailyArtifacts } from "./daily-report.js";
import type { DailyAutomationOptions } from "../types.js";

export interface AppDependencies {
  deps?: Dependencies;
  sheetGateway?: SheetGateway;
}

async function enrichCompanyRecord(baseDir: string, deps: Dependencies, companyRef: string): Promise<string> {
  const { db } = openDatabase(baseDir);
  const company = getCompanyByRef(db, companyRef);
  if (!company) {
    throw new Error(`Company not found: ${companyRef}`);
  }

  const result = await enrichCompanyFromWeb(company, deps);
  upsertCompany(db, result.companyInput);
  for (const contact of result.contacts) {
    upsertContact(db, contact);
  }

  return `Enriched ${String(company.name ?? companyRef)}. Pages checked: ${result.pagesChecked}, contacts refreshed: ${result.contacts.length}.`;
}

export function createApp(baseDir: string, dependencies: AppDependencies = {}) {
  const deps = dependencies.deps ?? createDefaultDependencies();
  const sheetGateway = dependencies.sheetGateway;
  const profileService = createProfileService(baseDir);
  const runService = createRunService(baseDir, deps);
  const jobsService = createJobsService(baseDir);
  const pipelineService = createPipelineService(baseDir);
  const companiesService = createCompaniesService(baseDir);
  const contactsService = createContactsService(baseDir);
  const sheetSyncService = createSheetSyncService(baseDir, sheetGateway);
  const statsService = createStatsService(baseDir);
  const outreachStatusService = createOutreachStatusService(baseDir);
  const tomorrowSourcingService = createTomorrowSourcingService(baseDir);

  return {
    async onboard(input: string) {
      const content = input || (process.stdin.isTTY ? "" : fs.readFileSync(0, "utf8"));
      const result = await profileService.onboard({ input: content });
      return `Profile synced.\nRole families: ${result.profile.roleFamilies.join(", ")}\nTarget seniority: ${result.profile.targetSeniority}\nSignals: ${result.profile.toolSignals.join(", ")}`;
    },

    async run(options: { lane?: SearchLane; companyWatchOnly?: boolean } = {}) {
      const result = await runService.run(options);
      return presentRunResult(result);
    },

    digest(limit = 5) {
      return presentJobList(jobsService.digest({ limit }), "digest");
    },

    shortlist(limit = 10) {
      return presentJobList(jobsService.shortlist({ limit }), "shortlist");
    },

    triage(limit = 10) {
      return presentTriage(jobsService.triage({ limit }));
    },

    draft(jobId: number) {
      return draftOutreach(baseDir, jobId);
    },

    explain(jobId: number) {
      const job = jobsService.getJob(jobId);
      if (!job) throw new SniperError(`Job ${jobId} was not found.`, "not_found");
      return presentJobDetail(job, "explain");
    },

    route(jobId: number) {
      const job = jobsService.getJob(jobId);
      if (!job) throw new SniperError(`Job ${jobId} was not found.`, "not_found");
      return presentJobDetail(job, "route");
    },

    pitch(jobId: number) {
      const job = jobsService.getJob(jobId);
      if (!job) throw new SniperError(`Job ${jobId} was not found.`, "not_found");
      return presentJobDetail(job, "pitch");
    },

    pipeline(input: string) {
      return presentPipelineResult(pipelineService.pipeline(input));
    },

    assets(jobId: number) {
      return presentPipelineResult(pipelineService.assets(jobId));
    },

    applyState(input: { jobId: number; status: "discovered" | "triaged" | "asset_ready" | "applied" | "contacted" | "reply_received" | "interviewing" | "rejected" | "archived"; method?: "ats" | "direct_email" | "founder_reachout" | "linkedin" | "other"; note?: string }) {
      return presentPipelineResult(pipelineService.updateApplyState(input));
    },

    blacklistAdd(input: { term: string; mode: "company" | "keyword"; lane?: SearchLane }) {
      const config = loadConfig(baseDir);
      const term = input.term.trim();
      if (!term) {
        throw new Error("blacklist add requires a term.");
      }
      if (input.mode === "company") {
        if (!config.blacklist.companies.includes(term)) {
          config.blacklist.companies.push(term);
        }
      } else if (input.lane) {
        config.blacklist.lanes[input.lane] ??= [];
        if (!config.blacklist.lanes[input.lane].includes(term)) {
          config.blacklist.lanes[input.lane].push(term);
        }
      } else if (!config.blacklist.keywords.includes(term)) {
        config.blacklist.keywords.push(term);
      }
      saveConfig(baseDir, config);
      return `Blacklisted ${input.mode}: ${term}${input.lane ? ` (${input.lane})` : ""}`;
    },

    companies(limit = 10) {
      return presentCompanies(companiesService.list({ limit }));
    },

    contacts(companyRef?: string) {
      return presentContacts(contactsService.list({ companyRef }));
    },

    async enrichCompany(companyRef: string) {
      return enrichCompanyRecord(baseDir, deps, companyRef);
    },

    dossier(companyRef: string) {
      const dossier = companiesService.dossier(companyRef);
      if (!dossier) throw new SniperError(`Company not found: ${companyRef}`, "not_found");
      return presentDossier(dossier);
    },

    contactLog(input: { companyRef: string; channel: "email" | "linkedin" | "ats" | "founder"; note?: string; jobId?: number }) {
      const { db } = openDatabase(baseDir);
      const entry = logContactAttempt(db, input.companyRef, input.channel, input.note ?? "", input.jobId);
      return `Logged contact attempt for ${input.companyRef} via ${entry.channel}.`;
    },

    outcomeLog(input: { companyRef: string; result: "no_reply" | "reply" | "call" | "interview" | "rejected" | "positive_signal"; note?: string; jobId?: number }) {
      const { db } = openDatabase(baseDir);
      const entry = logOutcome(db, input.companyRef, input.result, input.note ?? "", input.jobId);
      return `Logged outcome for ${input.companyRef}: ${entry.result}.`;
    },

    companyState(input: { companyRef: string; status: "reached" | "sent_email" | "talking" | "rejected" | "archived"; channel?: "email" | "linkedin" | "ats" | "founder"; note?: string; jobId?: number }) {
      const snapshot = outreachStatusService.setCompanyState(input);
      return `Updated ${snapshot.companyName}: ${snapshot.status}${snapshot.lastContactChannel ? ` via ${snapshot.lastContactChannel}` : ""}.`;
    },

    experiments() {
      const { db } = openDatabase(baseDir);
      const summary = summarizeExperiments(db);
      const routeLines = Object.entries(summary.replyRateByRoute).map(
        ([route, rate]) => `${route}: reply ${Math.round(rate * 100)}%, positive ${Math.round((summary.positiveOutcomeRateByRoute[route] ?? 0) * 100)}%`,
      );
      const themeLines = summary.topPitchThemes.map((theme) => `${theme.pitchTheme}: ${theme.count}`);
      return [
        "Route performance:",
        routeLines.join("\n") || "No logged outcomes yet.",
        "",
        "Top pitch themes:",
        themeLines.join("\n") || "No pitch data yet.",
      ].join("\n");
    },

    requeue(url: string, lane?: SearchLane) {
      const config = loadConfig(baseDir);
      const { db } = openDatabase(baseDir);
      const normalizedUrl = normalizeUrl(url);
      const targetLane = lane ?? getDefaultCompanyWatchLane(config);
      enqueueDiscoveryCandidates(db, [
        {
          url,
          normalizedUrl,
          sourceType: "page",
          lane: targetLane,
          intent: "unknown",
          query: "",
          confidence: 0.5,
          source: "manual",
          discoveredAt: new Date().toISOString(),
          domain: domainFromUrl(url),
          title: "",
          snippet: "",
        },
      ]);
      return `Queued ${url} for ${targetLane}.`;
    },

    sourcesTest() {
      const config = loadConfig(baseDir);
      const providers = getSearchProviders();
      return [
        `Search providers: ${providers.map((provider) => provider.name).join(", ") || "none"}`,
        `ATS boards configured: ${config.sources.atsBoards.length}`,
        `Job boards configured: ${config.sources.jobBoards.length}`,
        `RSS feeds configured: ${config.sources.rss.length}`,
        `Browser fallback: ${config.search.browserFallback ? "enabled" : "disabled"}`,
      ].join("\n");
    },

    stats() {
      return presentStats(statsService.get());
    },

    status() {
      return presentStatus(statsService.get());
    },

    async sourceTomorrow(options: { outputPath?: string; jsonPath?: string; pdfPath?: string } = {}) {
      return presentTomorrowSourcing(await tomorrowSourcingService.run(options));
    },

    exportJson(outputPath?: string) {
      const { db } = openDatabase(baseDir);
      const payload = {
        jobs: db.prepare("SELECT * FROM jobs ORDER BY score DESC, updated_at DESC").all(),
        companies: db.prepare("SELECT * FROM companies ORDER BY startup_score DESC, updated_at DESC").all(),
        contacts: db.prepare("SELECT * FROM contacts ORDER BY updated_at DESC").all(),
        runMetrics: db.prepare("SELECT * FROM run_metrics ORDER BY id DESC LIMIT 25").all(),
        contactLog: db.prepare("SELECT * FROM contact_log ORDER BY created_at DESC LIMIT 100").all(),
        outcomeLog: db.prepare("SELECT * FROM outcome_log ORDER BY created_at DESC LIMIT 100").all(),
        companyOutreachState: db.prepare("SELECT * FROM company_outreach_state ORDER BY updated_at DESC").all(),
      };
      const resolvedPath = outputPath || path.join(baseDir, "data", "sniper-export.json");
      fs.writeFileSync(resolvedPath, `${JSON.stringify(payload, null, 2)}\n`);
      return `Exported JSON to ${resolvedPath}`;
    },

    async sheetSync(scope: "all" | "companies_only" = "all") {
      const result = await sheetSyncService.sync(statsService.get().latestRun?.id ?? null, scope);
      const summary =
        scope === "companies_only"
          ? "Sheets sync complete. Companies and contacts refreshed."
          : `Sheets sync complete. ${result.jobs} job rows synced.`;
      return `${summary}\n${result.url}`;
    },

    async sheetPull() {
      if (process.env.SNIPER_ENABLE_SHEET_PULL !== "1") {
        throw new SniperError(
          "sheet pull is disabled by default. SQLite is canonical. Set SNIPER_ENABLE_SHEET_PULL=1 only for an intentional manual import.",
          "config_error",
        );
      }
      const result = await sheetSyncService.pull();
      return `Pulled ${result.pulled} rows from spreadsheet ${result.spreadsheetId}.`;
    },

    async daily(limit = 10) {
      const { db } = openDatabase(baseDir);

      const topJobs = db.prepare(
        "SELECT id, title, company_name, score, recommendation, recommended_route, url, pipeline_status, location, work_model, lane FROM jobs WHERE recommendation IN ('apply_now', 'cold_email') AND pipeline_status NOT IN ('applied', 'contacted', 'rejected', 'archived') ORDER BY score DESC, created_at DESC LIMIT ?"
      ).all(limit) as Array<Record<string, unknown>>;

      const topCompanies = db.prepare(
        "SELECT c.id, c.name, c.domain, c.startup_score, c.contactability_score, c.company_url, c.careers_url, c.team_url, cos.status as outreach_status, cos.last_contact_channel FROM companies c LEFT JOIN company_outreach_state cos ON c.id = cos.company_id WHERE c.startup_score > 0 OR c.contactability_score > 0 ORDER BY c.startup_score DESC, c.contactability_score DESC LIMIT ?"
      ).all(limit) as Array<Record<string, unknown>>;

      const contactedCompanies = db.prepare(
        "SELECT c.name, c.domain, cos.status, cos.last_contact_channel, cos.updated_at FROM companies c JOIN company_outreach_state cos ON c.id = cos.company_id WHERE cos.status IN ('reached', 'sent_email', 'talking', 'applied') ORDER BY cos.updated_at DESC"
      ).all() as Array<Record<string, unknown>>;

      const appliedJobs = db.prepare(
        "SELECT title, company_name, pipeline_status, applied_at FROM jobs WHERE pipeline_status IN ('applied', 'contacted') ORDER BY applied_at DESC LIMIT 10"
      ).all() as Array<Record<string, unknown>>;

      const lines = [];
      lines.push("=== Daily Job Sniper Digest ===");
      lines.push("Generated: " + new Date().toLocaleDateString());
      lines.push("");

      lines.push("--- Top " + topJobs.length + " Jobs to Act On ---");
      if (topJobs.length === 0) {
        lines.push("No new actionable jobs. Run 'sniper run' to discover more.");
      } else {
        for (const job of topJobs) {
          const rec = String(job.recommendation || "");
          const route = String(job.recommended_route || "");
          const icon = rec === "apply_now" ? "[APPLY]" : "[EMAIL]";
          lines.push(icon + " " + String(job.title || "") + " at " + String(job.company_name || ""));
          lines.push("  Score: " + job.score + " | " + String(job.location || "") + " " + String(job.work_model || ""));
          lines.push("  Route: " + route + " | " + String(job.url || ""));
          lines.push("");
        }
      }

      lines.push("--- Top " + topCompanies.length + " Companies to Cold Email ---");
      if (topCompanies.length === 0) {
        lines.push("No new company targets. Run 'sniper run --company-watch' to discover more.");
      } else {
        for (const company of topCompanies) {
          const status = String(company.outreach_status || "new");
          if (["reached", "sent_email", "talking", "applied"].includes(status)) continue;
          lines.push("[EMAIL] " + String(company.name || "") + " (" + String(company.domain || "") + ")");
          lines.push("  Startup score: " + company.startup_score + " | Contact score: " + company.contactability_score);
          if (company.careers_url) lines.push("  Careers: " + company.careers_url);
          if (company.team_url) lines.push("  Team: " + company.team_url);
          lines.push("");
        }
      }

      lines.push("--- Already Contacted (No Duplicates) ---");
      if (contactedCompanies.length === 0) {
        lines.push("No companies contacted yet.");
      } else {
        for (const c of contactedCompanies) {
          lines.push("  " + String(c.name || "") + " (" + String(c.domain || "") + ") - " + c.status + (c.last_contact_channel ? " via " + c.last_contact_channel : ""));
        }
      }

      lines.push("");
      lines.push("--- Recently Applied ---");
      if (appliedJobs.length === 0) {
        lines.push("No applications sent yet.");
      } else {
        for (const j of appliedJobs) {
          lines.push("  " + String(j.title || "") + " at " + String(j.company_name || "") + " - " + j.pipeline_status + (j.applied_at ? " (" + j.applied_at + ")" : ""));
        }
      }

      return lines.join("\n");
    },

    async automateDaily(options: DailyAutomationOptions = {}) {
      const result = await runDailyQueue(baseDir, deps, {
        limitJobs: options.limitJobs,
        limitCompanies: options.limitCompanies,
        dryRun: options.dryRun,
      });
      const report = writeDailyArtifacts(baseDir, result);
      return [
        `Daily queue complete.`,
        `Jobs: ${result.jobs.length} | Companies: ${result.companies.length}`,
        `Excluded: ${Object.values(result.excluded).reduce((a, b) => a + b, 0)}`,
        ``,
        `Artifacts:`,
        `  JSON:  ${report.jsonPath}`,
        `  Markdown: ${report.markdownPath}`,
      ].join("\n");
    },

    snap(input: { type: string; ref: string; status?: string; method?: string; note?: string }) {
      const { db } = openDatabase(baseDir);

      if (input.type === "job") {
        const jobId = Number(input.ref);
        if (!Number.isFinite(jobId)) {
          throw new Error("snap job requires a numeric job ID");
        }
        const status = input.status || "applied";
        const method = input.method || "ats";
        const note = input.note || "";
        db.prepare("UPDATE jobs SET pipeline_status = ?, applied_at = COALESCE(applied_at, datetime('now')), application_method = ?, updated_at = datetime('now') WHERE id = ?").run(status, method, jobId);
        return "Job " + jobId + " marked as " + status + " via " + method + (note ? ". Note: " + note : "");
      }

      const companyRef = input.ref;
      const status = input.status || "reached";
      const channel = input.method || "email";
      const note = input.note || "";

      const existing = db.prepare("SELECT id FROM companies WHERE canonical_key = ? OR name = ?").get(companyRef, companyRef) as { id: number } | undefined;
      if (!existing) {
        throw new Error("Company not found: " + companyRef);
      }

      db.prepare("INSERT OR REPLACE INTO company_outreach_state (company_id, status, last_contact_channel, note, source, updated_at) VALUES (?, ?, ?, ?, 'snap', datetime('now'))").run(
        existing.id, status, channel, note
      );
      return "Company " + companyRef + " marked as " + status + " via " + channel + (note ? ". Note: " + note : "");
    },
  };
}
