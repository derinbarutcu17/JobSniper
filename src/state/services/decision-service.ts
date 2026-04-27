import { buildDecisionSnapshot } from "../../normalization/decision.js";
import type { JobDecisionSnapshot, ListingCandidate, ProfileSummary, ScoreBreakdown } from "../../types.js";

export interface DecisionService {
  build(listing: ListingCandidate, profile: ProfileSummary, score: number, breakdown: ScoreBreakdown, eligibility: string): JobDecisionSnapshot;
}

export function createDecisionService(): DecisionService {
  return {
    build(listing, profile, score, breakdown, eligibility) {
      return buildDecisionSnapshot(listing, profile, score, breakdown, eligibility);
    },
  };
}
