import { normalizeText } from "../lib/text.js";
import type { ListingCandidate, ProfileSummary, SniperConfig } from "../types.js";

export interface ListingFilterDecision {
  keep: boolean;
  reason?: string;
}

const HARD_TITLE_EXCLUSIONS = [
  "senior",
  "staff",
  "principal",
  "head",
  "vp",
  "vice president",
  "director",
  "manager",
  "lead",
  "chief ",
];

function includesAny(normalized: string, terms: string[]): boolean {
  return terms.some((term) => normalized.includes(normalizeText(term)));
}

function targetLocationMatch(config: SniperConfig, profile: ProfileSummary, listing: ListingCandidate): boolean {
  const blob = normalizeText(
    `${listing.location} ${listing.country} ${listing.description} ${listing.remoteScope} ${listing.applicantLocationRequirements.join(" ")}`,
  );
  const preferredPlaceSignals = profile.preferredLocations.filter((entry) => !/^remote$/i.test(entry));
  const berlinMatch = includesAny(blob, config.search.priorityCities) || includesAny(blob, preferredPlaceSignals);
  if (berlinMatch) return true;

  const remoteOnly =
    listing.workModel === "remote" &&
    (/^\s*remote\s*$/i.test(listing.location) || listing.location.trim() === "");
  const explicitForeignCountry =
    Boolean(listing.country.trim()) &&
    !includesAny(normalizeText(listing.country), ["germany", "deutschland"]);

  return remoteOnly && !explicitForeignCountry;
}

export function earlyFilterListing(
  config: SniperConfig,
  profile: ProfileSummary,
  listing: ListingCandidate,
): ListingFilterDecision {
  const title = normalizeText(listing.title);
  const description = normalizeText(listing.description);

  if (includesAny(title, [...HARD_TITLE_EXCLUSIONS, ...config.blacklist.titleTerms, ...profile.avoidTitleTerms])) {
    return { keep: false, reason: "title_excluded" };
  }

  if (!targetLocationMatch(config, profile, listing)) {
    return { keep: false, reason: "location_outside_target" };
  }

  const laneBlacklist = config.blacklist.lanes[listing.lane] ?? [];
  if (includesAny(description, [...config.blacklist.keywords, ...laneBlacklist])) {
    return { keep: false, reason: "blacklist_keyword" };
  }

  return { keep: true };
}
