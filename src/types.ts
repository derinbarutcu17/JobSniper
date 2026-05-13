export type LaneId = string;
export type SearchLane = LaneId;
export type SourceType = "search" | "rss" | "ats" | "job_board" | "page" | "sitemap" | "career_page" | "team_page";
export type WorkModel = "remote" | "hybrid" | "onsite" | "unknown";
export type Category = "Good Match" | "Mid Match" | "Low Match" | "Excluded";
export type LaneType = "job" | "company_watch";
export type ContactKind =
  | "application_email"
  | "careers_email"
  | "general_contact_email"
  | "press_email"
  | "founder_email"
  | "recruiter_email"
  | "contact_form"
  | "linkedin_company"
  | "linkedin_person"
  | "team_page";
export type ConfidenceBand = "very_low" | "low" | "medium" | "high";
export type SeniorityTarget = "intern" | "junior" | "mid" | "senior";
export type PageIntent = "job" | "company" | "contact" | "unknown";
export type PageType = "job_detail" | "career_hub" | "team_page" | "contact_page" | "about_page" | "generic";
export type OpportunityRecommendation = "apply_now" | "cold_email" | "enrich_first" | "watch" | "discard";
export type RecommendedRoute =
  | "ats_only"
  | "ats_plus_cold_email"
  | "direct_email_first"
  | "founder_or_team_reachout"
  | "watch_company"
  | "no_action";
export type PitchTheme = "design" | "ai_workflows" | "design_engineering" | "startup_speed" | "systems_thinking" | "generalist";
export type ProbabilityBand = "low" | "medium" | "high";
export type PriorityBand = "low" | "medium" | "high";
export type ContactChannel = "email" | "linkedin" | "ats" | "founder";
export type OutcomeResult = "no_reply" | "reply" | "call" | "interview" | "rejected" | "positive_signal";
export type RunStatus = "running" | "succeeded" | "failed" | "partial";
export type OutreachStatus = "new" | "reached" | "sent_email" | "applied" | "talking" | "rejected" | "archived";
export type PipelineStatus =
  | "discovered"
  | "triaged"
  | "asset_ready"
  | "applied"
  | "contacted"
  | "reply_received"
  | "interviewing"
  | "rejected"
  | "archived";
export type ApplicationMethod = "ats" | "direct_email" | "founder_reachout" | "linkedin" | "other";

export interface RolePackTitleFamily {
  family: string;
  terms: string[];
}

export interface LaneConfig {
  label: string;
  type: LaneType;
  enabled: boolean;
  queries: {
    tr: string[];
    en: string[];
  };
  keywords: string[];
  queryTerms?: string[];
  profileSignals?: string[];
  titleFamilies?: RolePackTitleFamily[];
  mismatchTerms?: string[];
  startupTerms?: string[];
  companyTerms?: string[];
}

export interface RssSource {
  name: string;
  url: string;
}

export interface AtsBoardSource {
  name: string;
  provider: string;
  url: string;
  lane?: LaneId;
}

export interface JobBoardSource {
  name: string;
  provider: "linkedin" | "google_jobs";
  lane: LaneId;
  query?: string;
  location?: string;
  maxResults?: number;
}

export interface SniperConfig {
  search: {
    maxResultsPerQuery: number;
    maxQueriesPerLane: number;
    minScoreThreshold: number;
    browserFallback: boolean;
    searchProviderConcurrency: number;
    pageFetchConcurrency: number;
    maxPagesPerDomainPerRun: number;
    retries: number;
    timeoutMs: number;
    priorityCities: string[];
    priorityCountries: string[];
    remoteScopes: string[];
  };
  lanes: Record<LaneId, LaneConfig>;
  sources: {
    rss: RssSource[];
    atsBoards: AtsBoardSource[];
    jobBoards: JobBoardSource[];
  };
  blacklist: {
    companies: string[];
    keywords: string[];
    titleTerms: string[];
    softPenaltyTerms: string[];
    lanes: Record<LaneId, string[]>;
  };
  sheets: {
    spreadsheetId: string;
    createIfMissing: boolean;
    folderId: string;
    tabs: {
      jobs: string;
      companies: string;
      contacts: string;
      runMetrics: string;
      dailyJobsPrefix?: string;
    };
  };
  tomorrow: {
    ashbyQueries: string[];
    searchQueries: string[];
    curatedCompanies: TomorrowCuratedCompany[];
  };
}

export interface TomorrowCuratedCompany {
  company: string;
  query: string;
  roleHint: string;
}

export interface ProfileSummary {
  roleFamilies: string[];
  targetSeniority: SeniorityTarget;
  allowStretchRoles: boolean;
  avoidTitleTerms: string[];
  preferredLocations: string[];
  languagePreference: string[];
  toolSignals: string[];
  summary: string;
}

export interface SearchQuery {
  lane: LaneId;
  locale: "tr" | "en";
  query: string;
  family: "job" | "company" | "contact";
  providerHints?: string[];
}

export interface SearchResult {
  lane: LaneId;
  title: string;
  url: string;
  snippet: string;
  source: string;
  query: string;
  provider: string;
}

export interface DiscoveryCandidate {
  url: string;
  normalizedUrl: string;
  sourceType: SourceType;
  lane: LaneId;
  intent: PageIntent;
  query?: string;
  confidence: number;
  source: string;
  discoveredAt: string;
  domain: string;
  title: string;
  snippet: string;
}

export interface PageRecord {
  url: string;
  normalizedUrl: string;
  domain: string;
  sourceType: SourceType;
  pageType: PageType;
  intent: PageIntent;
  title: string;
  text: string;
  html: string;
  provider: string;
}

export interface ListingCandidate {
  lane: LaneId;
  externalId?: string;
  title: string;
  titleFamily: string;
  company: string;
  location: string;
  country: string;
  language: string;
  workModel: WorkModel;
  employmentType: string;
  salary: string;
  description: string;
  url: string;
  applyUrl: string;
  source: string;
  sourceType: SourceType;
  sourceUrls: string[];
  companyUrl: string;
  careersUrl: string;
  aboutUrl: string;
  teamUrl: string;
  contactUrl: string;
  pressUrl: string;
  companyLinkedinUrl: string;
  publicContacts: ContactCandidate[];
  postedAt: string;
  validThrough: string;
  department: string;
  experienceYearsText: string;
  remoteScope: string;
  applicantLocationRequirements: string[];
  applicationContactName: string;
  applicationContactEmail: string;
  parseConfidence: number;
  sourceConfidence: number;
  isRealJobPage: boolean;
  raw?: Record<string, unknown>;
}

export interface ContactCandidate {
  kind: ContactKind;
  name: string;
  title: string;
  email: string;
  linkedinUrl: string;
  sourceUrl: string;
  confidence: ConfidenceBand;
  evidenceType: string;
  evidenceExcerpt: string;
  isPublic: boolean;
  pageType: PageType;
}

export interface CompanyRecordInput {
  canonicalKey: string;
  name: string;
  domain: string;
  location: string;
  companyUrl: string;
  careersUrl: string;
  aboutUrl: string;
  teamUrl: string;
  contactUrl: string;
  pressUrl: string;
  linkedinUrl: string;
  description: string;
  sourceUrls: string[];
  publicContacts: string[];
  startupSignals: string[];
  hiringSignals: string[];
  founderNames: string[];
  cities: string[];
  sizeBand: string;
  stageText: string;
  remotePolicy: string;
  openRoleCount: number;
  startupScore: number;
  companyFitScore: number;
  hiringSignalScore: number;
  contactabilityScore: number;
  isStartupCandidate: boolean;
  recommendation?: OpportunityRecommendation;
  recommendationReason?: string;
  bestRoute?: RecommendedRoute;
  pitchTheme?: PitchTheme;
  pitchAngle?: string;
  pitchEvidence?: string[];
  directContactCount?: number;
  reachableNow?: boolean;
  priorityBand?: PriorityBand;
  lastSeenAt: string;
}

export interface ContactRecordInput {
  canonicalKey: string;
  companyCanonicalKey: string;
  name: string;
  title: string;
  email: string;
  sourceUrl: string;
  linkedinUrl: string;
  contactKind: ContactKind;
  notes: string;
  confidence: ConfidenceBand;
  evidenceType: string;
  evidenceExcerpt: string;
  isPublic: boolean;
  lastVerifiedAt: string;
  pageType: PageType;
  lastSeenAt: string;
}

export interface ScoreBreakdown {
  titleFit: number;
  skillFit: number;
  seniorityFit: number;
  locationFit: number;
  workModelFit: number;
  languageFit: number;
  companyFit: number;
  startupFit: number;
  freshnessFit: number;
  contactabilityFit: number;
  sourceQualityFit: number;
  positives: string[];
  negatives: string[];
  gatesPassed: string[];
  gatesFailed: string[];
}

export interface DecisionExplanation {
  why_apply_now: string[];
  why_cold_email: string[];
  why_enrich_first: string[];
  why_watch: string[];
  why_discard: string[];
}

export interface JobDecisionSnapshot {
  recommendation: OpportunityRecommendation;
  recommendationReason: string;
  explanation: DecisionExplanation;
  recommendedRoute: RecommendedRoute;
  routeConfidence: number;
  routeRationale: string;
  pitchTheme: PitchTheme;
  pitchAngle: string;
  pitchEvidence: string[];
  strongestProfileSignal: string;
  strongestCompanySignal: string;
  outreachLeverageScore: number;
  interviewProbabilityBand: ProbabilityBand;
  opportunityCostBand: ProbabilityBand;
}

export interface CompanyDecisionSnapshot {
  recommendation: OpportunityRecommendation;
  bestRoute: RecommendedRoute;
  pitchTheme: PitchTheme;
  pitchAngle: string;
  pitchEvidence: string[];
  directContactCount: number;
  reachableNow: boolean;
  priorityBand: PriorityBand;
  recommendationReason: string;
}

export interface CompanyOutreachStateRecord {
  id: number;
  company_id: number;
  status: OutreachStatus;
  last_contact_channel: ContactChannel | "";
  last_job_id: number | null;
  note: string;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface CompanyOutreachSnapshot {
  companyId: number;
  companyName: string;
  status: OutreachStatus;
  lastContactChannel: ContactChannel | "";
  lastJobId: number | null;
  latestNote: string;
  latestActivityAt: string;
  source: string;
}

export interface JobRecord {
  id: number;
  canonical_key: string;
  duplicate_group_key: string;
  external_id: string;
  title: string;
  title_family: string;
  company_id: number | null;
  company_name: string;
  location: string;
  country: string;
  language: string;
  work_model: WorkModel;
  employment_type: string;
  salary: string;
  description: string;
  url: string;
  apply_url: string;
  source: string;
  source_type: SourceType;
  lane: LaneId;
  status: string;
  category: Category;
  score: number;
  eligibility: string;
  match_rationale: string;
  score_explanation_json: string;
  relevant_projects: string;
  outreach_draft: string;
  public_contacts: string;
  source_urls: string;
  posted_at: string;
  valid_through: string;
  department: string;
  experience_years_text: string;
  remote_scope: string;
  parse_confidence: number;
  source_confidence: number;
  freshness_score: number;
  contactability_score: number;
  company_fit_score: number;
  startup_fit_score: number;
  is_real_job_page: number;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
  manual_status: string;
  owner_notes: string;
  priority: string;
  outreach_state: string;
  manual_contact_override: string;
  recommendation: OpportunityRecommendation;
  recommendation_reason: string;
  decision_explanation_json: string;
  recommended_route: RecommendedRoute;
  route_confidence: number;
  route_rationale: string;
  pitch_theme: PitchTheme;
  pitch_angle: string;
  pitch_evidence: string;
  strongest_profile_signal: string;
  strongest_company_signal: string;
  outreach_leverage_score: number;
  interview_probability_band: ProbabilityBand;
  opportunity_cost_band: ProbabilityBand;
  pipeline_status: PipelineStatus;
  applied_at: string;
  application_method: ApplicationMethod | "";
  application_url: string;
  asset_bundle_path: string;
  cv_asset_path: string;
  cover_letter_asset_path: string;
  outreach_note_asset_path: string;
}

export interface RunSummary {
  runId?: number;
  status?: RunStatus;
  totalFound: number;
  totalNew: number;
  totalUpdated: number;
  excluded: number;
  companiesTouched: number;
  contactsTouched: number;
  deduped: number;
  parsed: number;
  fetchSuccessRate: number;
  parseSuccessRate: number;
  jsFallbackRate: number;
  actionableCount?: number;
  applyNowCount?: number;
  coldEmailCount?: number;
  enrichFirstCount?: number;
  watchCount?: number;
  discardCount?: number;
  directContactCompanies?: number;
  founderSurfaceCompanies?: number;
  averageOutreachLeverageScore?: number;
  warnings?: string[];
  errors?: string[];
}

export interface PipelineContext {
  runId: number;
  lane?: SearchLane;
  companyWatchOnly?: boolean;
  configSnapshot: SniperConfig;
  profileSnapshot: ProfileSummary;
  sourceBreakdown: Record<string, number>;
  warnings: string[];
  errors: string[];
}

export interface RunRecord {
  id: number;
  started_at: string;
  finished_at: string;
  status: RunStatus;
  lane: string;
  mode: string;
  source_breakdown_json: string;
  warnings_json: string;
  errors_json: string;
  artifacts_json: string;
  summary_json: string;
  created_at: string;
  updated_at: string;
}

export interface JobSummary {
  id: number;
  canonicalKey: string;
  title: string;
  titleFamily: string;
  companyName: string;
  lane: LaneId;
  score: number;
  eligibility: string;
  category: Category;
  recommendation: OpportunityRecommendation;
  recommendedRoute: RecommendedRoute;
  routeConfidence: number;
  location: string;
  workModel: WorkModel;
  postedAt: string;
  url: string;
  pipelineStatus: PipelineStatus;
}

export interface JobDetail extends JobSummary {
  description: string;
  language: string;
  salary: string;
  department: string;
  pitchTheme: PitchTheme;
  pitchAngle: string;
  strongestProfileSignal: string;
  strongestCompanySignal: string;
  outreachLeverageScore: number;
  interviewProbabilityBand: ProbabilityBand;
  opportunityCostBand: ProbabilityBand;
  explanation: DecisionExplanation;
  publicContacts: ContactCandidate[];
  sourceUrls: string[];
  appliedAt: string;
  applicationMethod: ApplicationMethod | "";
  applicationUrl: string;
  assetBundlePath: string;
  cvAssetPath: string;
  coverLetterAssetPath: string;
  outreachNoteAssetPath: string;
}

export interface JobDetailView extends JobDetail {}

export interface TriageItem extends JobSummary {
  recommendationReason: string;
  outreachLeverageScore: number;
}

export interface AssetBundleView {
  jobId: number;
  bundlePath: string;
  cvPath: string;
  coverLetterPath: string;
  outreachNotePath: string;
}

export interface PipelineResult {
  job: JobDetailView;
  assets?: AssetBundleView;
  updatedStatus: PipelineStatus;
}

export interface CompanySummary {
  id: number;
  canonicalKey: string;
  name: string;
  domain: string;
  location: string;
  recommendation: OpportunityRecommendation;
  bestRoute: RecommendedRoute;
  startupScore: number;
  companyFitScore: number;
  hiringSignalScore: number;
  directContactCount: number;
  priorityBand: PriorityBand;
  careersUrl: string;
  outreachStatus: OutreachStatus;
  lastContactChannel: ContactChannel | "";
  latestActivityAt: string;
}

export interface CompanyDetail extends CompanySummary {
  companyUrl: string;
  aboutUrl: string;
  teamUrl: string;
  contactUrl: string;
  pressUrl: string;
  linkedinUrl: string;
  description: string;
  startupSignals: string[];
  hiringSignals: string[];
  publicContacts: string[];
  founderNames: string[];
  cities: string[];
  pitchTheme: PitchTheme;
  pitchAngle: string;
  recommendationReason: string;
  latestStatusNote: string;
}

export interface CompanyAggregate {
  company: CompanyDetail;
  jobs: JobSummary[];
  contacts: ContactSummary[];
  recentContactLog: ContactLogEntry[];
  recentOutcomeLog: OutcomeLogEntry[];
  evidence: string[];
  trustLevel: ConfidenceBand;
}

export interface CompanyDossierView {
  company: CompanyDetail;
  bestRoute: RecommendedRoute;
  recommendation: OpportunityRecommendation;
  recommendationReason: string;
  pitchTheme: PitchTheme;
  pitchAngle: string;
  contacts: ContactSummary[];
  jobs: JobSummary[];
  recentContactLog: ContactLogEntry[];
  recentOutcomeLog: OutcomeLogEntry[];
  evidence: string[];
  trustLevel: ConfidenceBand;
}

export interface ContactSummary {
  id: number;
  canonicalKey: string;
  companyName: string;
  kind: ContactKind | string;
  name: string;
  title: string;
  email: string;
  linkedinUrl: string;
  sourceUrl: string;
  confidence: ConfidenceBand;
  isPublic: boolean;
  evidenceType: string;
}

export interface RunMetricsSnapshot extends RunSummary {}

export interface RunResult {
  run: RunRecord;
  summary: RunSummary;
}

export interface StatsSnapshot {
  jobs: { total: number; eligible: number };
  companies: number;
  contacts: number;
  strategic: {
    actionable: number;
    applyNow: number;
    coldEmail: number;
    enrichFirst: number;
    watch: number;
    discard: number;
    averageOutreachLeverage: number;
  };
  latestRun?: RunRecord | null;
}

export interface SheetSyncResult {
  spreadsheetId: string;
  url: string;
  jobs: number;
  runId?: number | null;
}

export interface OnboardRequest {
  input: string;
}

export interface RunRequest {
  lane?: SearchLane;
  companyWatchOnly?: boolean;
}

export interface TriageListRequest {
  limit?: number;
}

export interface JobListRequest {
  limit?: number;
}

export interface CompanyListRequest {
  limit?: number;
}

export interface ContactsListRequest {
  companyRef?: string;
}

export interface ContactLogEntry {
  id: number;
  company_id: number;
  job_id: number | null;
  channel: ContactChannel;
  note: string;
  created_at: string;
}

export interface OutcomeLogEntry {
  id: number;
  company_id: number;
  job_id: number | null;
  result: OutcomeResult;
  note: string;
  created_at: string;
}

export interface ApplicationRecord {
  id: number;
  job_id: number;
  company_id: number | null;
  status: PipelineStatus;
  method: ApplicationMethod;
  submitted_at: string;
  last_updated_at: string;
  notes: string;
  source: string;
  asset_bundle_path: string;
}

export interface HttpResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export interface Dependencies {
  fetch: (input: string, init?: RequestInit) => Promise<HttpResponseLike>;
  now: () => Date;
}

export interface SearchProvider {
  name: string;
  search(query: SearchQuery, deps: Dependencies): Promise<SearchResult[]>;
}

export type TomorrowSourcingUrgency = "high" | "medium" | "low";

export interface TomorrowProfileSignals {
  summary: string;
  toolSignals: string[];
  preferredLocations: string[];
  targetSeniority: string;
}

export interface TomorrowSourcingEvidence {
  label: string;
  value: string;
}

export interface TomorrowSourcingCandidateContact {
  kind: string;
  value: string;
}

export interface TomorrowApplicationTarget {
  company: string;
  role: string;
  whyItFits: string;
  applicationLink: string;
  urgency: TomorrowSourcingUrgency;
  confidence: "high" | "medium" | "low";
  whyItBeatAlternatives: string;
  source: string;
  score: number;
  evidence: TomorrowSourcingEvidence[];
  nextAction: string;
}

export interface TomorrowCompanyOutreachTarget {
  company: string;
  whyItFits: string;
  targetType?: string;
  contactRoute: string;
  whoToAddress: string;
  contactConfidence: "high" | "medium" | "low";
  whyItIsFresh: string;
  nextAction: string;
  score: number;
  evidence: TomorrowSourcingEvidence[];
}

export interface TomorrowExclusionRecord {
  company: string;
  reason: string;
  evidence?: TomorrowSourcingEvidence[];
}

export interface TomorrowSourcingGmailMatch {
  company: string;
  matchedValue: string;
  confidence: "high" | "medium" | "low";
  timestamp: string;
  source: string;
}

export interface TomorrowSourcingReport {
  generatedAt: string;
  gmailAudit: {
    available: boolean;
    reason: string;
    matches: TomorrowSourcingGmailMatch[];
  };
  topApplications: TomorrowApplicationTarget[];
  reserveApplications: TomorrowApplicationTarget[];
  topOutreachCompanies: TomorrowCompanyOutreachTarget[];
  reserveOutreachCompanies: TomorrowCompanyOutreachTarget[];
  excludedAlreadyContacted: TomorrowExclusionRecord[];
  excludedNotGoodEnough: TomorrowExclusionRecord[];
}

export interface TomorrowSourcingResult {
  report: TomorrowSourcingReport;
  outputPath?: string;
  jsonPath?: string;
  pdfPath?: string;
  text?: string;
}

export interface TomorrowSourcingOptions {
  outputPath?: string;
  jsonPath?: string;
  pdfPath?: string;
}
