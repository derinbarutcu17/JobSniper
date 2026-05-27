import type { Dependencies, RecommendedRoute } from "../types.js";

export type DailyMode = "normal" | "deep";
export type DailyState = "found" | "applied" | "contacted";
export type ConfidenceLabel = "high" | "good" | "maybe" | "low";
export type ContactRouteType =
  | "public_email"
  | "hiring_email"
  | "generic_email"
  | "contact_form"
  | "linkedin"
  | "team_page";

export interface ProfileConfig {
  name: string;
  location: string;
  primaryPositioning: string;
  portfolioUrl: string;
  githubUrl: string;
  acceptedRoleFamilies: string[];
  blockedRoleFamilies: string[];
  projectSummaries: string[];
  coreSkills: string[];
}

export interface ProfileCacheSource {
  label: string;
  url: string;
  summary: string;
  fetchedAt: string;
}

export interface ProfileContextCache {
  generatedAt: string;
  expiresAt: string;
  sources: ProfileCacheSource[];
  summary: string;
  warnings: string[];
}

export interface GmailAuditEntry {
  kind: "sent" | "received";
  subject: string;
  from: string;
  to: string;
  date: string;
  companyName?: string;
  companyDomain?: string;
  inferredEvent?: "contacted" | "applied";
  evidenceSummary: string;
}

export interface DailyEngineOptions {
  mode: DailyMode;
  refreshProfile?: boolean;
  emitJson?: boolean;
  noSheet?: boolean;
  resetSheet?: boolean;
  noAutoDeep?: boolean;
  jobsLimit?: number;
  companiesLimit?: number;
  deps?: Dependencies;
  hooks?: Partial<DailyEngineHooks>;
}

export interface DailyDiscoverySummary {
  lanes: string[];
  warnings: string[];
  sourcesAttempted: string[];
}

export interface RecommendationExplanation {
  reasons: string[];
  warnings: string[];
}

export interface JobRecommendation {
  rank: number;
  canonicalKey: string;
  state: DailyState;
  confidence: number;
  confidenceLabel: ConfidenceLabel;
  company: string;
  companyDomain: string;
  title: string;
  location: string;
  workModel: string;
  languageNote: string;
  jobUrl: string;
  applyUrl: string;
  source: string;
  recommendedRoute: RecommendedRoute | "apply";
  whyFit: string;
  reasons: string[];
  warnings: string[];
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface CompanyRecommendation {
  rank: number;
  canonicalDomain: string;
  state: DailyState;
  confidence: number;
  confidenceLabel: ConfidenceLabel;
  company: string;
  website: string;
  location: string;
  companyType: string;
  contactRoute: string;
  contactType: ContactRouteType;
  contactQuality: string;
  source: string;
  stage: string;
  sizeBand: string;
  priorityBand: string;
  stageRank: number;
  whyFit: string;
  reasons: string[];
  warnings: string[];
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface DailySkippedItem {
  label: string;
  reason:
    | "already_contacted"
    | "already_applied"
    | "duplicate"
    | "senior_role"
    | "german_required"
    | "bad_location"
    | "no_contact_route"
    | "low_confidence";
  details: string;
}

export interface GmailAuditStatus {
  fileFound: boolean;
  importedSignals: number;
  appliedMutations: number;
  contactedMutations: number;
  warnings: string[];
}

export interface ProfileCacheStatus {
  usedCache: boolean;
  refreshed: boolean;
  staleFallback: boolean;
  cachePath: string;
  warnings: string[];
}

export interface SheetsSyncStatus {
  skipped: boolean;
  ok: boolean;
  message: string;
  spreadsheetUrl?: string;
  warnings: string[];
}

export interface DailySummary {
  jobsRecommended: number;
  companiesRecommended: number;
  alreadyAppliedSkipped: number;
  alreadyContactedSkipped: number;
  duplicatesRemoved: number;
  autoDeepTriggered: boolean;
}

export interface DailyReportPayload {
  generatedAt: string;
  mode: DailyMode;
  profileCache: ProfileCacheStatus;
  gmailAudit: GmailAuditStatus;
  sheets: SheetsSyncStatus;
  summary: DailySummary;
  jobs: JobRecommendation[];
  companies: CompanyRecommendation[];
  skipped: DailySkippedItem[];
  discovery: DailyDiscoverySummary;
  reportPath: string;
  jsonPath: string;
}

export interface DailyEngineResult {
  payload: DailyReportPayload;
  markdown: string;
  json: string;
}

export interface DailyEngineHooks {
  runDiscovery(
    baseDir: string,
    options: DailyEngineOptions,
  ): Promise<DailyDiscoverySummary>;
  syncSheets(
    baseDir: string,
    payload: DailyReportPayload,
  ): Promise<SheetsSyncStatus>;
}
