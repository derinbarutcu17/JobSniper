import type { CompanyDossierView, CompanySummary, ContactSummary, JobDetail, JobSummary, PipelineResult, RunResult, StatsSnapshot, TomorrowSourcingResult, TriageItem } from "../types.js";

export function presentRunResult(result: RunResult): string {
  const warningLine = result.summary.warnings?.length ? `Warnings: ${result.summary.warnings.join(" | ")}` : "";
  const errorLine = result.summary.errors?.length ? `Errors: ${result.summary.errors.join(" | ")}` : "";
  return [
    `Scout complete. Run #${result.run.id} ${result.run.status}.`,
    `Found ${result.summary.totalFound}, new ${result.summary.totalNew}, refreshed ${result.summary.totalUpdated}, excluded ${result.summary.excluded}, deduped ${result.summary.deduped}, parsed ${result.summary.parsed}.`,
    warningLine,
    errorLine,
  ].filter(Boolean).join("\n");
}

export function presentJobList(items: JobSummary[], mode: "digest" | "shortlist" = "digest"): string {
  if (!items.length) return mode === "digest" ? "No ranked jobs yet. Run `run` first." : "No eligible shortlist yet.";
  return items.map((job, index) => {
    if (mode === "shortlist") {
      return `${index + 1}. [${job.id}] ${job.title} @ ${job.companyName} | ${Math.round(job.score)} | ${job.recommendation} | ${job.recommendedRoute} | ${job.location || "Unknown"}`;
    }
    return `${index + 1}. [${job.id}] ${job.title} @ ${job.companyName} | ${job.category} | ${Math.round(job.score)} | ${job.location || "Unknown"} | ${job.eligibility}`;
  }).join("\n");
}

export function presentTriage(items: TriageItem[]): string {
  if (!items.length) return "No triaged opportunities yet.";
  return items.map((job, index) =>
    `${index + 1}. [${job.id}] ${job.title} @ ${job.companyName} | ${job.recommendation} | route ${job.recommendedRoute} | leverage ${Math.round(job.outreachLeverageScore)}`,
  ).join("\n");
}

export function presentJobDetail(job: JobDetail, mode: "explain" | "route" | "pitch"): string {
  if (mode === "route") {
    return [
      `[${job.id}] ${job.title} @ ${job.companyName}`,
      `Recommended route: ${job.recommendedRoute}`,
      `Confidence: ${Math.round(job.routeConfidence * 100)}%`,
    ].join("\n");
  }
  if (mode === "pitch") {
    return [
      `[${job.id}] ${job.title} @ ${job.companyName}`,
      `Theme: ${job.pitchTheme}`,
      `Angle: ${job.pitchAngle || "No pitch angle stored."}`,
      `Strongest profile signal: ${job.strongestProfileSignal || "Unknown"}`,
      `Strongest company signal: ${job.strongestCompanySignal || "Unknown"}`,
    ].join("\n");
  }
  return [
    `[${job.id}] ${job.title} @ ${job.companyName}`,
    `Score: ${Math.round(job.score)} | ${job.category} | ${job.eligibility}`,
    `Recommendation: ${job.recommendation} | Route: ${job.recommendedRoute} (${Math.round(job.routeConfidence * 100)}%)`,
    `Title family: ${job.titleFamily || "Unknown"}`,
    `Pitch: ${job.pitchTheme} | ${job.pitchAngle || "None"}`,
    `Positives: ${job.explanation.why_apply_now.join("; ") || "None"}`,
    `Negatives: ${job.explanation.why_discard.join("; ") || "None"}`,
  ].join("\n");
}

export function presentCompanies(companies: CompanySummary[]): string {
  if (!companies.length) return "No companies tracked yet. Run `run` first.";
  return companies.map((company, index) =>
    `${index + 1}. ${company.name} | ${company.recommendation} | outreach ${company.outreachStatus} | route ${company.bestRoute} | startup ${Math.round(company.startupScore)} | fit ${Math.round(company.companyFitScore)} | ${company.location || "Unknown"} | ${company.careersUrl || ""}`,
  ).join("\n");
}

export function presentContacts(contacts: ContactSummary[]): string {
  if (!contacts.length) return "No contacts tracked yet.";
  return contacts.slice(0, 20).map((contact, index) =>
    `${index + 1}. ${contact.companyName} | ${contact.kind} | ${contact.email || contact.linkedinUrl || ""} | ${contact.confidence}`,
  ).join("\n");
}

export function presentDossier(dossier: CompanyDossierView): string {
  return [
    dossier.company.name,
    `Recommendation: ${dossier.recommendation}`,
    `Best route: ${dossier.bestRoute}`,
    `Priority: ${dossier.company.priorityBand}`,
    `Outreach status: ${dossier.company.outreachStatus}`,
    `Trust: ${dossier.trustLevel}`,
    `Why it matters: ${dossier.recommendationReason}`,
    `Pitch theme: ${dossier.pitchTheme}`,
    `Pitch angle: ${dossier.pitchAngle}`,
    `Contacts found: ${dossier.contacts.length}`,
    `Open roles tracked: ${dossier.jobs.length}`,
    dossier.jobs.length
      ? `Top roles: ${dossier.jobs.slice(0, 3).map((job) => `${job.title} (${job.recommendation})`).join("; ")}`
      : "Top roles: none tracked",
  ].join("\n");
}

export function presentStats(snapshot: StatsSnapshot): string {
  return [
    `Jobs: ${snapshot.jobs.total} total, ${snapshot.jobs.eligible} eligible`,
    `Companies: ${snapshot.companies}`,
    `Contacts: ${snapshot.contacts}`,
    `Strategic: ${snapshot.strategic.actionable} actionable | apply ${snapshot.strategic.applyNow} | cold email ${snapshot.strategic.coldEmail} | enrich ${snapshot.strategic.enrichFirst} | watch ${snapshot.strategic.watch} | discard ${snapshot.strategic.discard}`,
    `Average outreach leverage: ${Math.round(snapshot.strategic.averageOutreachLeverage)}`,
    snapshot.latestRun
      ? `Last run: #${snapshot.latestRun.id} ${snapshot.latestRun.status}`
      : "Last run: none",
    `Outreach: ${snapshot.outreach.contacted} contacted | ${snapshot.outreach.talking} talking | ${snapshot.outreach.rejected} rejected | ${snapshot.outreach.archived} archived`,
    `Applications: ${snapshot.outreach.applied} applied | ${snapshot.outreach.interviewing} interviewing`,
  ].join("\n");
}

export function presentStatus(snapshot: StatsSnapshot): string {
  const dateLabel = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return [
    `Pipeline Status - ${dateLabel}`,
    "",
    `  Companies: ${snapshot.companies}  |  Contacts: ${snapshot.contacts}  |  Jobs: ${snapshot.jobs.total} (${snapshot.jobs.eligible} eligible)`,
    "",
    `  Outreach:    ${snapshot.outreach.contacted} contacted  ${snapshot.outreach.talking} talking  ${snapshot.outreach.rejected} rejected  ${snapshot.outreach.archived} archived`,
    `  Applied:     ${snapshot.outreach.applied} applied  ${snapshot.outreach.interviewing} interviewing`,
    "",
    `  Actionable:  ${snapshot.strategic.applyNow} apply-now  ${snapshot.strategic.coldEmail} cold-email  ${snapshot.strategic.enrichFirst} enrich-first`,
    `  Last run:    ${snapshot.latestRun ? `#${snapshot.latestRun.id} ${snapshot.latestRun.status}` : "none"}`,
  ].join("\n");
}

export function presentPipelineResult(result: PipelineResult): string {
  const assetLine = result.assets
    ? `Assets: ${result.assets.cvPath} | ${result.assets.coverLetterPath} | ${result.assets.outreachNotePath}`
    : "Assets: none generated for this status.";
  return [
    `Pipeline updated job [${result.job.id}] ${result.job.title} @ ${result.job.companyName}`,
    `Status: ${result.updatedStatus}`,
    `Recommendation: ${result.job.recommendation} | Route: ${result.job.recommendedRoute}`,
    assetLine,
  ].join("\n");
}

export function presentTomorrowSourcing(result: TomorrowSourcingResult): string {
  const lines: string[] = [];
  lines.push(`Tomorrow sourcing report-only run ready. Applications ${result.report.topApplications.length}, outreach ${result.report.topOutreachCompanies.length}.`);
  lines.push(`Gmail audit: ${result.report.gmailAudit.mode || (result.report.gmailAudit.available ? "available" : "unavailable")} (${result.report.gmailAudit.reason})`);
  if (result.report.dedupeSource) lines.push(`Dedupe source: ${result.report.dedupeSource}`);
  lines.push("");
  lines.push("Top 5 Applications:");
  for (const item of result.report.topApplications) {
    lines.push(`- ${item.company} | ${item.role} | ${item.urgency} | ${item.confidence} | ${item.applicationLink}`);
    lines.push(`  Why it fits: ${item.whyItFits}`);
    lines.push(`  Next action tomorrow: ${item.nextAction}`);
  }
  lines.push("");
  lines.push("Top 5 Berlin Startups to Email:");
  for (const item of result.report.topOutreachCompanies) {
    lines.push(`- ${item.company} | ${item.targetType || item.whoToAddress} | ${item.contactConfidence} | ${item.contactStatus || "unknown"} | ${item.contactRoute}`);
    lines.push(`  Why it fits: ${item.whyItFits}`);
    lines.push(`  Freshness: ${item.whyItIsFresh}`);
    lines.push(`  Next action tomorrow: ${item.nextAction}`);
  }
  lines.push("");
  lines.push("Reserve Applications:");
  for (const item of result.report.reserveApplications) {
    lines.push(`- ${item.company} | ${item.role} | ${item.urgency} | ${item.confidence} | ${item.applicationLink}`);
  }
  lines.push("");
  lines.push("Reserve Startups:");
  for (const item of result.report.reserveOutreachCompanies) {
    lines.push(`- ${item.company} | ${item.targetType || item.whoToAddress} | ${item.contactConfidence} | ${item.contactStatus || "unknown"} | ${item.contactRoute}`);
  }
  lines.push("");
  lines.push("Excluded Because Already Contacted:");
  for (const item of result.report.excludedAlreadyContacted.slice(0, 10)) {
    lines.push(`- ${item.company} | ${item.reason}`);
  }
  lines.push("");
  lines.push("Excluded Because Not Good Enough:");
  for (const item of result.report.excludedNotGoodEnough.slice(0, 10)) {
    lines.push(`- ${item.company} | ${item.reason}`);
  }
  return lines.join("\n");
}
