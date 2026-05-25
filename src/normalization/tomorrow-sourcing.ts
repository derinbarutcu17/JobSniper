import type { TomorrowApplicationTarget, TomorrowCompanyOutreachTarget, TomorrowExclusionRecord, TomorrowProfileSignals, TomorrowSourcingCandidateContact, TomorrowSourcingEvidence, TomorrowSourcingUrgency } from "../types.js";

const SENIOR_TERMS = ["senior", "staff", "principal", "lead", "director", "manager", "head", "vp", "vice president"];
const STRETCH_TERMS = ["founding", "founder", "co-founder"];
const BACKEND_ONLY_TERMS = ["backend", "back-end", "platform", "sre", "devops", "infrastructure", "data engineer"];

export function normalizeCompanyToken(input: string): string {
  return input
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\b(gmbh|inc|llc|ltd|ag|ug|studio|labs?)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeDomain(input: string): string {
  return input.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
}

function linkDomain(value: string): string {
  if (!/^https?:\/\//.test(value)) return "";
  return normalizeDomain(value);
}

function isSeniorTitle(title: string): boolean {
  const lower = title.toLowerCase();
  return SENIOR_TERMS.some((term) => lower.includes(term));
}

function isStretchTitle(title: string): boolean {
  const lower = title.toLowerCase();
  return STRETCH_TERMS.some((term) => lower.includes(term));
}

function isBackendHeavyTitle(title: string): boolean {
  const lower = title.toLowerCase();
  return BACKEND_ONLY_TERMS.some((term) => lower.includes(term)) && !/(front|design|product|full stack|full-stack)/.test(lower);
}

export function isBerlinRelevant(location: string, text: string): boolean {
  const joined = `${location} ${text}`.toLowerCase();
  if (joined.includes("berlin")) return true;
  if (/germany/.test(joined) && /remote|hybrid/.test(joined)) return true;
  if (/europe|eu|emea/.test(joined) && /remote/.test(joined)) return true;
  return false;
}

export function inferUrgency(text: string, publishedDate?: string): TomorrowSourcingUrgency {
  if (publishedDate) {
    const published = Date.parse(publishedDate);
    if (Number.isFinite(published)) {
      const days = Math.floor((Date.now() - published) / 86400000);
      if (days <= 7) return "high";
      if (days <= 21) return "medium";
    }
  }
  const lower = text.toLowerCase();
  if (/apply now|hiring now|new role|urgent|today|yesterday|days ago/.test(lower)) return "high";
  if (/this week|recently|new/.test(lower)) return "medium";
  return "medium";
}

function matchCount(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  return terms.reduce((count, term) => count + (lower.includes(term) ? 1 : 0), 0);
}

export function scoreApplicationFit(input: {
  title: string;
  location: string;
  text: string;
  sourceTrust: number;
  publishedDate?: string;
  profile: TomorrowProfileSignals;
}): number {
  const joined = `${input.title} ${input.text}`.toLowerCase();
  if (isSeniorTitle(input.title)) return -100;
  if (isStretchTitle(input.title)) return -40;
  if (isBackendHeavyTitle(input.title)) return -35;
  if (!isBerlinRelevant(input.location, input.text)) return -30;

  let score = 0;
  if (/berlin/.test(`${input.title} ${input.location} ${input.text}`.toLowerCase())) score += 12;
  else if (/germany/.test(`${input.location} ${input.text}`.toLowerCase())) score += 4;
  else if (/europe|eu|emea/.test(`${input.location} ${input.text}`.toLowerCase())) score += 1;
  if (/design engineer/.test(joined)) score += 40;
  if (/product engineer/.test(joined)) score += 34;
  if (/frontend/.test(joined) && /design|product|ux|ui/.test(joined)) score += 28;
  if (/full stack|full-stack/.test(joined) && /product|design|ai/.test(joined)) score += 25;
  if (/product designer/.test(joined)) score += 22;
  if (/ai/.test(joined)) score += 10;
  if (/react|typescript|next\.js|nextjs/.test(joined)) score += 8;
  if (/hybrid|remote/.test(joined)) score += 4;
  score += Math.min(10, matchCount(joined, input.profile.toolSignals));
  score += input.sourceTrust * 10;

  const urgency = inferUrgency(joined, input.publishedDate);
  if (urgency === "high") score += 8;
  if (urgency === "medium") score += 4;

  return score;
}

export function buildApplicationReasons(input: {
  title: string;
  text: string;
  location: string;
  profile: TomorrowProfileSignals;
}): string[] {
  const joined = `${input.title} ${input.text}`.toLowerCase();
  const reasons: string[] = [];
  if (/design engineer/.test(joined)) reasons.push("direct design-and-engineering overlap");
  if (/product engineer|product/.test(joined)) reasons.push("strong product ownership signal");
  if (/react|typescript|next/.test(joined)) reasons.push("matches shipped web product stack");
  if (/ai/.test(joined)) reasons.push("AI-adjacent product context");
  if (isBerlinRelevant(input.location, input.text)) reasons.push("Berlin or Berlin-compatible role");
  if (!reasons.length) reasons.push("closest current fit to design-plus-builder profile");
  return reasons;
}

export function buildOutreachReasons(company: {
  pitchTheme: string;
  route: string;
  startupScore: number;
  directContactCount: number;
}): string[] {
  const reasons: string[] = [];
  if (company.pitchTheme.includes("ai")) reasons.push("AI-native product angle");
  if (company.pitchTheme.includes("design")) reasons.push("clear product and interface relevance");
  if (company.route.includes("direct_email")) reasons.push("usable direct contact route");
  if (company.route.includes("founder")) reasons.push("team-level forwarding path");
  if (company.startupScore >= 16) reasons.push("strong startup signal");
  if (company.directContactCount > 0) reasons.push("public contact surface already available");
  return reasons.length ? reasons : ["good Berlin startup fit with a credible outreach route"];
}

export function resolveContactConfidence(contact: TomorrowSourcingCandidateContact): "high" | "medium" | "low" {
  const value = (contact.value || "").toLowerCase();
  if (/jobs@|career|careers|talent|hiring|recruit|founder/.test(value)) return "high";
  if (/hello@|info@|contact@/.test(value)) return "medium";
  if (/linkedin|contact form/.test(contact.kind.toLowerCase())) return "low";
  return "medium";
}

export function shouldExcludeOutreachCandidate(input: {
  companyName: string;
  domain?: string;
  seedMatches: Set<string>;
  dbMatches: Set<string>;
  gmailHighMatches: Set<string>;
  gmailMediumMatches: Set<string>;
}): { excluded: boolean; reason?: string } {
  const normalized = normalizeCompanyToken(input.companyName);
  const domain = normalizeDomain(input.domain || "");
  if (input.dbMatches.has(normalized) || (domain && input.dbMatches.has(domain))) {
    return { excluded: true, reason: "already tracked as contacted/applied/rejected in Job Sniper" };
  }
  if (input.gmailHighMatches.has(normalized) || (domain && input.gmailHighMatches.has(domain))) {
    return { excluded: true, reason: "strong Gmail Sent match" };
  }
  if (input.seedMatches.has(normalized) || (domain && input.seedMatches.has(domain))) {
    return { excluded: true, reason: "present in prior-contact seed list" };
  }
  if (input.gmailMediumMatches.has(normalized) || (domain && input.gmailMediumMatches.has(domain))) {
    return { excluded: true, reason: "medium-confidence Gmail Sent match" };
  }
  return { excluded: false };
}

export function rankApplications(items: TomorrowApplicationTarget[]): TomorrowApplicationTarget[] {
  return [...items].sort((left, right) => right.score - left.score || urgencyWeight(right.urgency) - urgencyWeight(left.urgency) || left.company.localeCompare(right.company));
}

export function rankOutreach(items: TomorrowCompanyOutreachTarget[]): TomorrowCompanyOutreachTarget[] {
  return [...items].sort((left, right) => right.score - left.score || confidenceWeight(right.contactConfidence) - confidenceWeight(left.contactConfidence) || left.company.localeCompare(right.company));
}

function urgencyWeight(value: TomorrowSourcingUrgency): number {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
}

function confidenceWeight(value: "high" | "medium" | "low"): number {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
}

export function dedupeApplications(items: TomorrowApplicationTarget[]): TomorrowApplicationTarget[] {
  const seen = new Set<string>();
  const output: TomorrowApplicationTarget[] = [];
  for (const item of rankApplications(items)) {
    const key = `${normalizeCompanyToken(item.company)}|${linkDomain(item.applicationLink)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

export function exclusionRecord(company: string, reason: string, evidence: TomorrowSourcingEvidence[] = []): TomorrowExclusionRecord {
  return { company, reason, evidence };
}
