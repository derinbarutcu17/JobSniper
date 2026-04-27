import { extractYearRequirement, findFirstMatch, includesAny, normalizeText, pickTopSignals } from "./lib/text.js";
import { collectMismatchTerms, collectQueryTerms, collectStartupTerms, normalizeTitleFamilyWithConfig } from "./role-packs.js";
import type {
  Category,
  LaneId,
  ListingCandidate,
  ProfileSummary,
  ScoreBreakdown,
  SniperConfig,
} from "./types.js";

const SYSTEM_EXCLUDE_TITLE_TERMS = [
  "senior",
  "lead",
  "manager",
  "director",
  "head",
  "vp",
  "principal",
  "staff",
  "cto",
  "cso",
  "chief ",
  "architect",
];

const GLOBAL_MISMATCH_TERMS = [
  "customer success",
  "sales manager",
  "growth partner",
  "account executive",
  "business development",
  "legal",
  "commission-only",
  "devops",
  "kubernetes",
  "golang",
  "backend",
];

const CLOSED_ROLE_TERMS = [
  "applications closed",
  "application closed",
  "position filled",
  "job expired",
  "role expired",
  "no longer hiring",
  "no longer accepting applications",
];

function categoryFromScore(score: number): Category {
  if (score >= 75) return "Good Match";
  if (score >= 55) return "Mid Match";
  return "Low Match";
}

export function normalizeTitleFamily(config: SniperConfig, lane: LaneId, text: string): string {
  return normalizeTitleFamilyWithConfig(config, lane, text);
}

function gateEligibility(config: SniperConfig, profile: ProfileSummary, listing: ListingCandidate): ScoreBreakdown {
  const title = normalizeText(listing.title);
  const description = normalizeText(listing.description);
  const locationBlob = normalizeText(
    `${listing.location} ${listing.country} ${listing.remoteScope} ${listing.applicantLocationRequirements.join(" ")}`,
  );
  const laneMismatchTerms = [...GLOBAL_MISMATCH_TERMS, ...collectMismatchTerms(config, listing.lane)];
  const breakdown: ScoreBreakdown = {
    titleFit: 0,
    skillFit: 0,
    seniorityFit: 0,
    locationFit: 0,
    workModelFit: 0,
    languageFit: 0,
    companyFit: 0,
    startupFit: 0,
    freshnessFit: 0,
    contactabilityFit: 0,
    sourceQualityFit: 0,
    positives: [],
    negatives: [],
    gatesPassed: [],
    gatesFailed: [],
  };

  const excludedTitleTerms = [
    ...new Set(
      [...SYSTEM_EXCLUDE_TITLE_TERMS, ...config.blacklist.titleTerms, ...profile.avoidTitleTerms]
        .map((term) => normalizeText(term))
        .filter(Boolean),
    ),
  ];

  if (config.blacklist.companies.some((company) => normalizeText(listing.company).includes(normalizeText(company)))) {
    breakdown.gatesFailed.push("company_blacklist");
  }

  if (
    excludedTitleTerms.some((term) => title.includes(term))
  ) {
    breakdown.gatesFailed.push("title_seniority");
    breakdown.negatives.push(`Title contains excluded seniority term: ${findFirstMatch(title, excludedTitleTerms)}`);
  } else {
    breakdown.gatesPassed.push("title_seniority");
  }

  if (CLOSED_ROLE_TERMS.some((term) => description.includes(normalizeText(term)) || title.includes(normalizeText(term)))) {
    breakdown.gatesFailed.push("job_closed");
    breakdown.negatives.push("Role appears closed or expired.");
  } else {
    breakdown.gatesPassed.push("job_open");
  }

  if (laneMismatchTerms.some((term) => title.includes(normalizeText(term)) || description.includes(normalizeText(term)))) {
    breakdown.gatesFailed.push("role_family_mismatch");
    breakdown.negatives.push(`Role family mismatch: ${findFirstMatch(`${title} ${description}`, laneMismatchTerms)}`);
  } else {
    breakdown.gatesPassed.push("role_family_fit");
  }

  if (listing.lane === "student_jobs") {
    if (includesAny(description, ["full-time only", "full time only", "must be available full time", "40 hours", "5+ years", "4+ years", "senior"])) {
      breakdown.negatives.push("Student lane penalty: the role looks full-time or senior-heavy.");
      breakdown.seniorityFit -= 12;
    }
    if (includesAny(description, ["werkstudent", "working student", "intern", "internship", "student assistant", "part-time"])) {
      breakdown.seniorityFit += 8;
    }
  }

  const preferredPlaceSignals = profile.preferredLocations.filter((entry) => !/^remote$/i.test(entry));
  const matchesTargetLocation =
    includesAny(locationBlob, config.search.priorityCities) ||
    includesAny(locationBlob, preferredPlaceSignals);
  const remoteOnly =
    listing.workModel === "remote" &&
    (/^\s*remote\s*$/i.test(listing.location) || listing.location.trim() === "");
  const explicitForeignCountry =
    Boolean(listing.country.trim()) &&
    !includesAny(listing.country, ["germany", "deutschland"]);
  if (!matchesTargetLocation && (explicitForeignCountry || !remoteOnly)) {
    breakdown.gatesFailed.push("location_outside_target");
    breakdown.negatives.push("Role is outside the configured target zone.");
  } else {
    breakdown.gatesPassed.push("location_fit");
  }

  return breakdown;
}

export function scoreListing(
  config: SniperConfig,
  profile: ProfileSummary,
  listing: ListingCandidate,
): { score: number; category: Category; rationale: string; relevantProjects: string[]; breakdown: ScoreBreakdown; eligibility: string; titleFamily: string } {
  const breakdown = gateEligibility(config, profile, listing);
  if (breakdown.gatesFailed.length) {
    return {
      score: 0,
      category: "Excluded",
      rationale: breakdown.negatives.join(" "),
      relevantProjects: [],
      breakdown,
      eligibility: "excluded",
      titleFamily: normalizeTitleFamily(config, listing.lane, listing.title),
    };
  }

  const titleFamily = normalizeTitleFamily(config, listing.lane, listing.title);
  const titleBlob = normalizeText(`${listing.title} ${titleFamily}`);
  const descriptionBlob = normalizeText(`${listing.description} ${listing.location} ${listing.language}`);
  const allBlob = `${titleBlob} ${descriptionBlob}`;

  const titleMatches = pickTopSignals(titleBlob, collectQueryTerms(config, listing.lane), 5);
  breakdown.titleFit = Math.min(18, titleMatches.length * 6);
  if (titleMatches.length) {
    breakdown.positives.push(`Title family fit (${listing.lane}): ${titleMatches.join(", ")}`);
    breakdown.gatesPassed.push("title_family");
  }

  const profileMatches = pickTopSignals(allBlob, profile.toolSignals, 6);
  breakdown.skillFit = Math.min(20, profileMatches.length * 4);
  if (profileMatches.length) {
    breakdown.positives.push(`Skill overlap: ${profileMatches.join(", ")}`);
  }

  const requiredYears = extractYearRequirement(listing.description);
  if (profile.targetSeniority === "junior") {
    if (requiredYears && /\b([5-9]|1\d)\b/.test(requiredYears)) {
      breakdown.seniorityFit -= 20;
      breakdown.negatives.push(`Experience ask too high: ${requiredYears}`);
    } else {
      breakdown.seniorityFit += 10;
      breakdown.gatesPassed.push("seniority");
    }
  } else if (profile.allowStretchRoles) {
    breakdown.seniorityFit += 6;
  }

  if (includesAny(allBlob, config.search.priorityCities) || includesAny(allBlob, profile.preferredLocations)) {
    breakdown.locationFit += 16;
    breakdown.positives.push("Matches target location.");
  } else if (listing.workModel === "remote") {
    breakdown.locationFit += 8;
    breakdown.positives.push("Remote role kept in target funnel.");
  } else if (listing.workModel === "onsite") {
    breakdown.locationFit -= 10;
    breakdown.negatives.push("Onsite role outside preferred zone.");
  }

  if (listing.workModel === "hybrid" || listing.workModel === "remote") {
    breakdown.workModelFit += 8;
  }

  if (profile.languagePreference.includes(listing.language)) {
    breakdown.languageFit += 6;
  } else if (listing.language) {
    breakdown.languageFit -= 4;
    breakdown.negatives.push(`Language mismatch: ${listing.language}`);
  }

  const startupTerms = collectStartupTerms(config, listing.lane);
  if (includesAny(allBlob, startupTerms)) {
    breakdown.startupFit += 10;
    breakdown.positives.push(`Pack startup/company signal (${listing.lane}).`);
  }

  if (listing.publicContacts.some((contact) => contact.confidence === "high")) {
    breakdown.contactabilityFit += 12;
  } else if (listing.publicContacts.length) {
    breakdown.contactabilityFit += 6;
  }

  if (listing.parseConfidence >= 0.7) {
    breakdown.sourceQualityFit += 6;
  }
  if (listing.postedAt) {
    breakdown.freshnessFit += 4;
  }

  if (includesAny(descriptionBlob, config.blacklist.softPenaltyTerms)) {
    breakdown.negatives.push("Description contains management-heavy language.");
    breakdown.companyFit -= 8;
  }
  const laneBlacklist = config.blacklist.lanes[listing.lane] ?? [];
  if (includesAny(descriptionBlob, [...config.blacklist.keywords, ...laneBlacklist])) {
    breakdown.companyFit -= 15;
    breakdown.negatives.push(`Out-of-scope role family detected for ${listing.lane}.`);
  }

  const score =
    breakdown.titleFit +
    breakdown.skillFit +
    breakdown.seniorityFit +
    breakdown.locationFit +
    breakdown.workModelFit +
    breakdown.languageFit +
    breakdown.companyFit +
    breakdown.startupFit +
    breakdown.freshnessFit +
    breakdown.contactabilityFit +
    breakdown.sourceQualityFit;
  const category = categoryFromScore(score);
  const relevantProjects = [...new Set([...titleMatches, ...profileMatches])].slice(0, 5);

  return {
    score,
    category,
    rationale: [...breakdown.positives, ...breakdown.negatives].join(" ").trim(),
    relevantProjects,
    breakdown,
    eligibility: category === "Low Match" ? "soft_filtered" : "eligible",
    titleFamily,
  };
}
