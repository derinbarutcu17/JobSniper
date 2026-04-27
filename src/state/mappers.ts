import type {
  CompanyAggregate,
  CompanyDetail,
  CompanyDossierView,
  CompanyOutreachSnapshot,
  CompanySummary,
  ConfidenceBand,
  ContactLogEntry,
  ContactSummary,
  JobDetail,
  JobRecord,
  JobSummary,
  OutcomeLogEntry,
  RunRecord,
} from "../types.js";

function parseJsonArray<T>(value: string, fallback: T): T {
  try {
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function scoreToTrust(score: number): ConfidenceBand {
  if (score >= 0.85) return "high";
  if (score >= 0.65) return "medium";
  if (score >= 0.4) return "low";
  return "very_low";
}

export function mapJobRecordToSummary(job: JobRecord): JobSummary {
  return {
    id: job.id,
    canonicalKey: job.canonical_key,
    title: job.title,
    titleFamily: job.title_family,
    companyName: job.company_name,
    lane: job.lane,
    score: job.score,
    eligibility: job.eligibility,
    category: job.category,
    recommendation: job.recommendation,
    recommendedRoute: job.recommended_route,
    routeConfidence: job.route_confidence,
    location: job.location,
    workModel: job.work_model,
    postedAt: job.posted_at,
    url: job.url,
    pipelineStatus: job.pipeline_status || "discovered",
  };
}

export function mapJobRecordToDetail(job: JobRecord): JobDetail {
  return {
    ...mapJobRecordToSummary(job),
    description: job.description,
    language: job.language,
    salary: job.salary,
    department: job.department,
    pitchTheme: job.pitch_theme,
    pitchAngle: job.pitch_angle,
    strongestProfileSignal: job.strongest_profile_signal,
    strongestCompanySignal: job.strongest_company_signal,
    outreachLeverageScore: job.outreach_leverage_score,
    interviewProbabilityBand: job.interview_probability_band,
    opportunityCostBand: job.opportunity_cost_band,
    explanation: parseJsonArray(job.decision_explanation_json, {
      why_apply_now: [],
      why_cold_email: [],
      why_enrich_first: [],
      why_watch: [],
      why_discard: [],
    }),
    publicContacts: parseJsonArray(job.public_contacts, []),
    sourceUrls: parseJsonArray(job.source_urls, []),
    appliedAt: job.applied_at || "",
    applicationMethod: job.application_method || "",
    applicationUrl: job.application_url || "",
    assetBundlePath: job.asset_bundle_path || "",
    cvAssetPath: job.cv_asset_path || "",
    coverLetterAssetPath: job.cover_letter_asset_path || "",
    outreachNoteAssetPath: job.outreach_note_asset_path || "",
  };
}

export function mapCompanyRowToSummary(company: Record<string, unknown>, outreach?: CompanyOutreachSnapshot): CompanySummary {
  return {
    id: Number(company.id ?? 0),
    canonicalKey: String(company.canonical_key ?? ""),
    name: String(company.name ?? ""),
    domain: String(company.domain ?? ""),
    location: String(company.location ?? ""),
    recommendation: String(company.recommendation ?? "watch") as CompanySummary["recommendation"],
    bestRoute: String(company.best_route ?? "watch_company") as CompanySummary["bestRoute"],
    startupScore: Number(company.startup_score ?? 0),
    companyFitScore: Number(company.company_fit_score ?? 0),
    hiringSignalScore: Number(company.hiring_signal_score ?? 0),
    directContactCount: Number(company.direct_contact_count ?? 0),
    priorityBand: String(company.priority_band ?? "low") as CompanySummary["priorityBand"],
    careersUrl: String(company.careers_url ?? ""),
    outreachStatus: outreach?.status ?? "new",
    lastContactChannel: outreach?.lastContactChannel ?? "",
    latestActivityAt: outreach?.latestActivityAt ?? "",
  };
}

export function mapCompanyRowToDetail(company: Record<string, unknown>, outreach?: CompanyOutreachSnapshot): CompanyDetail {
  return {
    ...mapCompanyRowToSummary(company, outreach),
    companyUrl: String(company.company_url ?? ""),
    aboutUrl: String(company.about_url ?? ""),
    teamUrl: String(company.team_url ?? ""),
    contactUrl: String(company.contact_url ?? ""),
    pressUrl: String(company.press_url ?? ""),
    linkedinUrl: String(company.linkedin_url ?? ""),
    description: String(company.description ?? ""),
    startupSignals: parseJsonArray(String(company.startup_signals ?? "[]"), []),
    hiringSignals: parseJsonArray(String(company.hiring_signals ?? "[]"), []),
    publicContacts: parseJsonArray(String(company.public_contacts ?? "[]"), []),
    founderNames: parseJsonArray(String(company.founder_names ?? "[]"), []),
    cities: parseJsonArray(String(company.cities ?? "[]"), []),
    pitchTheme: String(company.pitch_theme ?? "generalist") as CompanyDetail["pitchTheme"],
    pitchAngle: String(company.pitch_angle ?? ""),
    recommendationReason: String(company.recommendation_reason ?? ""),
    latestStatusNote: outreach?.latestNote ?? "",
  };
}

export function mapContactRowToSummary(contact: Record<string, unknown>): ContactSummary {
  return {
    id: Number(contact.id ?? 0),
    canonicalKey: String(contact.canonical_key ?? ""),
    companyName: String(contact.company_name ?? ""),
    kind: String(contact.contact_kind ?? ""),
    name: String(contact.name ?? ""),
    title: String(contact.title ?? ""),
    email: String(contact.email ?? ""),
    linkedinUrl: String(contact.linkedin_url ?? ""),
    sourceUrl: String(contact.source_url ?? ""),
    confidence: String(contact.confidence ?? "low") as ContactSummary["confidence"],
    isPublic: Boolean(Number(contact.is_public ?? 0)),
    evidenceType: String(contact.evidence_type ?? ""),
  };
}

export function mapRunRow(row: Record<string, unknown>): RunRecord {
  return {
    id: Number(row.id ?? 0),
    started_at: String(row.started_at ?? ""),
    finished_at: String(row.finished_at ?? ""),
    status: String(row.status ?? "running") as RunRecord["status"],
    lane: String(row.lane ?? ""),
    mode: String(row.mode ?? ""),
    source_breakdown_json: String(row.source_breakdown_json ?? "{}"),
    warnings_json: String(row.warnings_json ?? "[]"),
    errors_json: String(row.errors_json ?? "[]"),
    artifacts_json: String(row.artifacts_json ?? "[]"),
    summary_json: String(row.summary_json ?? "{}"),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

export function buildCompanyAggregate(
  company: Record<string, unknown>,
  jobs: JobRecord[],
  contacts: Array<Record<string, unknown>>,
  contactLog: ContactLogEntry[],
  outcomeLog: OutcomeLogEntry[],
  outreach?: CompanyOutreachSnapshot,
): CompanyAggregate {
  const companyDetail = mapCompanyRowToDetail(company, outreach);
  const jobSummaries = jobs.map(mapJobRecordToSummary);
  const contactSummaries = contacts.map(mapContactRowToSummary);
  const evidence = [
    ...companyDetail.startupSignals,
    ...companyDetail.hiringSignals,
    ...(companyDetail.pitchAngle ? [companyDetail.pitchAngle] : []),
  ].filter(Boolean).slice(0, 8);
  const trustScore = Math.max(
    Number(company.startup_score ?? 0) / 20,
    Number(company.contactability_score ?? 0) / 18,
    Number(company.hiring_signal_score ?? 0) / 12,
  );
  return {
    company: companyDetail,
    jobs: jobSummaries,
    contacts: contactSummaries,
    recentContactLog: contactLog,
    recentOutcomeLog: outcomeLog,
    evidence,
    trustLevel: scoreToTrust(trustScore),
  };
}

export function buildCompanyDossierView(aggregate: CompanyAggregate): CompanyDossierView {
  return {
    company: aggregate.company,
    bestRoute: aggregate.company.bestRoute,
    recommendation: aggregate.company.recommendation,
    recommendationReason: aggregate.company.recommendationReason,
    pitchTheme: aggregate.company.pitchTheme,
    pitchAngle: aggregate.company.pitchAngle,
    contacts: aggregate.contacts,
    jobs: aggregate.jobs,
    recentContactLog: aggregate.recentContactLog,
    recentOutcomeLog: aggregate.recentOutcomeLog,
    evidence: aggregate.evidence,
    trustLevel: aggregate.trustLevel,
  };
}
