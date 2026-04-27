import { includesAny } from "../lib/text.js";
import type { ContactCandidate, JobDecisionSnapshot, ListingCandidate, ProfileSummary, RecommendedRoute } from "../types.js";

function hasDirectEmail(contacts: ContactCandidate[]): boolean {
  return contacts.some((contact) => Boolean(contact.email));
}

function contactQuality(contact: ContactCandidate): number {
  const email = contact.email.toLowerCase();
  let score = 0;
  if (/^(hello|contact|info|team|careers|jobs|join|hiring)@/.test(email)) score += 8;
  if (/^(founder|ceo|cto|talent|people|recruiting|hr|hello-world)@/.test(email)) score += 14;
  if (/^(support|billing|payment|help|security|privacy|legal|press|affiliate|notifications?)@/.test(email)) score -= 18;
  if (/noreply|no-reply|do-not-reply/.test(email)) score -= 30;
  if (contact.confidence === "high") score += 8;
  if (contact.confidence === "low") score -= 4;
  if (contact.kind === "founder_email" || contact.kind === "recruiter_email") score += 10;
  if (contact.kind === "press_email") score -= 20;
  return score;
}

function hasHighQualityEmail(contacts: ContactCandidate[]): boolean {
  return contacts.some((contact) => Boolean(contact.email) && contactQuality(contact) >= 16);
}

function hasFounderOrTeamSurface(listing: ListingCandidate): boolean {
  return Boolean(listing.teamUrl || listing.contactUrl || listing.aboutUrl);
}

function looksStartupish(listing: ListingCandidate): boolean {
  return includesAny(
    `${listing.description} ${listing.company} ${listing.department} ${listing.url}`,
    ["startup", "founding", "seed", "series a", "small team", "0-1", "early stage"],
  );
}

export function inferRoute(
  listing: ListingCandidate,
  score: number,
  startupFit: number,
): Pick<JobDecisionSnapshot, "recommendedRoute" | "routeConfidence" | "routeRationale" | "outreachLeverageScore"> {
  const directEmail = hasDirectEmail(listing.publicContacts);
  const highQualityEmail = hasHighQualityEmail(listing.publicContacts);
  const founderSurface = hasFounderOrTeamSurface(listing);
  const startupish = looksStartupish(listing) || startupFit > 6;
  const hasAtsPage = listing.sourceType === "ats" || includesAny(`${listing.url} ${listing.applyUrl}`, ["greenhouse", "lever", "ashby", "workable", "smartrecruiters", "personio", "wellfound"]);
  const highConfidenceContacts = listing.publicContacts.some((contact) => contact.confidence === "high");
  const weakSurface = !listing.isRealJobPage || listing.parseConfidence < 0.5 || listing.sourceConfidence < 0.55;

  let recommendedRoute: RecommendedRoute = "no_action";
  let routeConfidence = 0.2;
  let routeRationale = "No reliable route stands out yet.";

  if (hasAtsPage && highQualityEmail) {
    recommendedRoute = "ats_plus_cold_email";
    routeConfidence = highConfidenceContacts ? 0.84 : 0.72;
    routeRationale = "The role has an ATS path and a public contact route, so both channels can reinforce each other.";
  } else if (highQualityEmail && startupish) {
    recommendedRoute = "direct_email_first";
    routeConfidence = highConfidenceContacts ? 0.92 : 0.8;
    routeRationale = "Public direct contact exists and the company looks reachable enough for outbound first contact.";
  } else if (founderSurface && startupish && (highQualityEmail || !directEmail)) {
    recommendedRoute = "founder_or_team_reachout";
    routeConfidence = 0.76;
    routeRationale = "The company looks small enough that a founder or team surface is a viable first route.";
  } else if (hasAtsPage && score >= 45) {
    recommendedRoute = "ats_only";
    routeConfidence = 0.64;
    routeRationale = "The role looks real enough to pursue, but no stronger public route is available yet.";
  } else if (startupish || founderSurface) {
    recommendedRoute = "watch_company";
    routeConfidence = 0.54;
    routeRationale = "The company looks more interesting than the current role surface, so company-level monitoring is stronger than immediate application.";
  }

  if (
    weakSurface &&
    (recommendedRoute === "ats_only" || recommendedRoute === "founder_or_team_reachout") &&
    !directEmail
  ) {
    recommendedRoute = founderSurface || startupish ? "watch_company" : "no_action";
    routeConfidence = founderSurface || startupish ? 0.42 : 0.25;
    routeRationale = founderSurface || startupish
      ? "The page is weak, so company-level watching is safer than trusting the role surface."
      : "The page is too weak to support a confident route yet.";
  } else if (weakSurface) {
    routeConfidence = Math.max(0.2, routeConfidence - 0.18);
    routeRationale = `${routeRationale} Confidence is reduced because the page surface is weak.`;
  }

  const outreachLeverageScore =
    (highQualityEmail ? 40 : directEmail ? 4 : 0) +
    (highConfidenceContacts ? 20 : 0) +
    (founderSurface ? 10 : 0) +
    (startupish ? 15 : 0) +
    (score >= 65 ? 15 : score >= 50 ? 8 : 0) -
    (weakSurface ? 10 : 0);

  return {
    recommendedRoute,
    routeConfidence,
    routeRationale,
    outreachLeverageScore: Math.max(0, Math.min(100, outreachLeverageScore)),
  };
}
