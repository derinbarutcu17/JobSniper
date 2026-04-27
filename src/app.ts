import fs from "node:fs";
import path from "node:path";
import { loadConfig, saveConfig } from "./config.js";
import { enrichCompanyFromWeb } from "./company-enrich.js";
import { logContactAttempt, logOutcome } from "./contact-log.js";
import {
  enqueueDiscoveryCandidates,
  getCompanyByRef,
  listCompanies,
  listContacts,
  openDatabase,
  upsertCompany,
  upsertContact,
} from "./db.js";
import { draftOutreach } from "./draft.js";
import { summarizeExperiments } from "./experiments.js";
import { SniperError } from "./errors.js";
import { createDefaultDependencies } from "./lib/http.js";
import { canonicalCompanyKey, canonicalContactKey, domainFromUrl, normalizeUrl } from "./lib/url.js";
import { getDefaultCompanyWatchLane } from "./role-packs.js";
import { buildPageRecord, extractContacts } from "./search/extract.js";
import { getSearchProviders } from "./search/web.js";
import type { SheetGateway } from "./sheets.js";
import type { Dependencies, SearchLane } from "./types.js";
import { presentCompanies, presentContacts, presentDossier, presentJobDetail, presentJobList, presentPipelineResult, presentRunResult, presentStats, presentTriage } from "./presenters.js";
import { createCompaniesService } from "./services/companies-service.js";
import { createContactsService } from "./services/contacts-service.js";
import { createJobsService } from "./services/jobs-service.js";
import { createPipelineService } from "./services/pipeline-service.js";
import { createProfileService } from "./services/profile-service.js";
import { createRunService } from "./services/run-service.js";
import { createSheetSyncService } from "./services/sheet-sync-service.js";
import { createStatsService } from "./services/stats-service.js";

export interface AppDependencies {
  deps?: Dependencies;
  sheetGateway?: SheetGateway;
}

function parseCompanyRef(input: string): { id?: number; key?: string } {
  const maybeId = Number(input);
  if (Number.isFinite(maybeId)) {
    return { id: maybeId };
  }
  return { key: input.trim() };
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

    exportJson(outputPath?: string) {
      const { db } = openDatabase(baseDir);
      const payload = {
        jobs: db.prepare("SELECT * FROM jobs ORDER BY score DESC, updated_at DESC").all(),
        companies: db.prepare("SELECT * FROM companies ORDER BY startup_score DESC, updated_at DESC").all(),
        contacts: db.prepare("SELECT * FROM contacts ORDER BY updated_at DESC").all(),
        runMetrics: db.prepare("SELECT * FROM run_metrics ORDER BY id DESC LIMIT 25").all(),
        contactLog: db.prepare("SELECT * FROM contact_log ORDER BY created_at DESC LIMIT 100").all(),
        outcomeLog: db.prepare("SELECT * FROM outcome_log ORDER BY created_at DESC LIMIT 100").all(),
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
  };
}
