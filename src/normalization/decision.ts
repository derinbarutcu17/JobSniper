import { inferPitch } from "./pitch.js";
import { inferRoute } from "./route.js";
import type { DecisionExplanation, JobDecisionSnapshot, ListingCandidate, ProbabilityBand, ProfileSummary, ScoreBreakdown } from "../types.js";

function bandFromScore(score: number): ProbabilityBand {
  if (score >= 72) return "high";
  if (score >= 50) return "medium";
  return "low";
}

function costBand(score: number, route: string, seniorityPenalty: boolean): ProbabilityBand {
  if (seniorityPenalty || route === "ats_only") return "high";
  if (score >= 70 && route !== "no_action") return "low";
  return "medium";
}

export function buildDecisionSnapshot(
  listing: ListingCandidate,
  profile: ProfileSummary,
  score: number,
  breakdown: ScoreBreakdown,
  eligibility: string,
): JobDecisionSnapshot {
  const route = inferRoute(listing, score, breakdown.startupFit);
  const pitch = inferPitch(listing, profile);
  const explanation: DecisionExplanation = {
    why_apply_now: [],
    why_cold_email: [],
    why_enrich_first: [],
    why_watch: [],
    why_discard: [],
  };

  if (score >= 70) explanation.why_apply_now.push("High overall fit score.");
  if (listing.isRealJobPage) explanation.why_apply_now.push("This looks like a real job page.");
  if (route.recommendedRoute === "direct_email_first" || route.recommendedRoute === "ats_plus_cold_email") {
    explanation.why_cold_email.push("A real public contact route exists.");
  }
  if (!listing.publicContacts.length) explanation.why_enrich_first.push("No public contact route was found yet.");
  if (!listing.isRealJobPage) explanation.why_enrich_first.push("The source looks weaker than a direct job page.");
  if (breakdown.startupFit > 0) explanation.why_watch.push("The company looks strategically interesting even beyond this exact role.");
  if (eligibility === "excluded") explanation.why_discard.push("The role failed hard filters.");
  if (breakdown.gatesFailed.includes("location_outside_target")) explanation.why_discard.push("Location fit is outside the target zone.");
  if (breakdown.negatives.some((entry) => /experience ask too high/i.test(entry))) explanation.why_discard.push("The seniority ask looks too high.");

  const seniorityPenalty = breakdown.negatives.some((entry) => /experience ask too high/i.test(entry));
  const outboundRoute =
    route.recommendedRoute === "direct_email_first" ||
    route.recommendedRoute === "founder_or_team_reachout" ||
    route.recommendedRoute === "ats_plus_cold_email";
  const weakSurface = !listing.isRealJobPage || listing.parseConfidence < 0.5 || listing.sourceConfidence < 0.55;

  let recommendation: JobDecisionSnapshot["recommendation"] = "watch";
  let recommendationReason = "Worth keeping visible, but not yet a top-priority pursuit.";

  if (eligibility === "excluded" || score < 35) {
    recommendation = "discard";
    recommendationReason = explanation.why_discard[0] ?? "The role is unlikely to justify more time.";
  } else if (
    score >= 68 &&
    listing.isRealJobPage &&
    (route.recommendedRoute === "ats_only" || route.recommendedRoute === "ats_plus_cold_email")
  ) {
    recommendation = "apply_now";
    recommendationReason = explanation.why_apply_now[0] ?? "The role is strong enough to pursue immediately.";
  } else if (
    score >= 55 &&
    outboundRoute &&
    (!weakSurface || score >= 70)
  ) {
    recommendation = "cold_email";
    recommendationReason = explanation.why_cold_email[0] ?? "Outbound contact looks stronger than passive waiting.";
  } else if (
    score >= 45 &&
    (!listing.publicContacts.length || weakSurface || route.recommendedRoute === "watch_company")
  ) {
    recommendation = "enrich_first";
    recommendationReason = explanation.why_enrich_first[0] ?? "This looks promising, but the route needs more validation first.";
  } else if (score >= 40 || breakdown.startupFit > 0) {
    recommendation = "watch";
    recommendationReason = explanation.why_watch[0] ?? "The company may be worth monitoring even if this exact role is not.";
  } else {
    recommendation = "discard";
    recommendationReason = explanation.why_discard[0] ?? "The opportunity cost looks too high for the likely upside.";
  }

  return {
    recommendation,
    recommendationReason,
    explanation,
    recommendedRoute: recommendation === "discard" ? "no_action" : route.recommendedRoute,
    routeConfidence: route.routeConfidence,
    routeRationale: route.routeRationale,
    pitchTheme: pitch.pitchTheme,
    pitchAngle: pitch.pitchAngle,
    pitchEvidence: pitch.pitchEvidence,
    strongestProfileSignal: pitch.strongestProfileSignal,
    strongestCompanySignal: pitch.strongestCompanySignal,
    outreachLeverageScore: recommendation === "discard" ? 0 : route.outreachLeverageScore,
    interviewProbabilityBand: bandFromScore(score),
    opportunityCostBand: costBand(score, route.recommendedRoute, seniorityPenalty),
  };
}
