import { findFirstMatch, normalizeText, pickTopSignals } from "../lib/text.js";
import type { JobDecisionSnapshot, ListingCandidate, PitchTheme, ProfileSummary } from "../types.js";

const DESIGN_TERMS = ["figma", "design systems", "product design", "visual design", "designer", "ux designer", "ui designer"];
const AI_TERMS = ["ai", "llm", "agent", "automation", "openai", "workflow"];
const CODE_TERMS = ["typescript", "react", "node", "python", "frontend", "developer tools"];
const STARTUP_TERMS = ["startup", "founding", "seed", "series a", "small team", "0-1", "ship quickly"];

function countSignals(blob: string, terms: string[]): number {
  return terms.reduce((total, term) => total + (blob.includes(normalizeText(term)) ? 1 : 0), 0);
}

function inferPitchTheme(listing: ListingCandidate, profile: ProfileSummary): PitchTheme {
  const titleBlob = normalizeText(listing.title);
  const blob = normalizeText(`${listing.title} ${listing.description} ${listing.company} ${profile.toolSignals.join(" ")}`);
  const designScore = countSignals(blob, DESIGN_TERMS);
  const aiScore = countSignals(blob, AI_TERMS) + countSignals(titleBlob, AI_TERMS);
  const codeScore = countSignals(blob, CODE_TERMS);
  const startupScore = countSignals(blob, STARTUP_TERMS);

  if (aiScore >= 2 || (aiScore >= 1 && codeScore >= 1 && /ai|agent|workflow|automation|llm/i.test(listing.title))) {
    return "ai_workflows";
  }
  if (designScore >= 2 && codeScore >= 1) return "design_engineering";
  if (designScore >= 1) return "design";
  if (startupScore >= 2) return "startup_speed";
  if (codeScore >= 1) return "systems_thinking";
  return "generalist";
}

function angleForTheme(theme: PitchTheme, company: string, role: string, strongestProfileSignal: string, strongestCompanySignal: string): string {
  switch (theme) {
    case "design":
      return `Lead with how your design judgment can help ${company} make ${role} clearer, faster, and more user-centered.`;
    case "ai_workflows":
      return `Lead with how you can help ${company} turn AI workflows into shipped product leverage, not just prototypes.`;
    case "design_engineering":
      return `Lead with the wedge that you bridge product taste and implementation speed for ${company}.`;
    case "startup_speed":
      return `Lead with your ability to move quickly in ambiguous startup environments and contribute before the role scope is fully settled.`;
    case "systems_thinking":
      return `Lead with your systems thinking and ability to improve the product stack around ${role}.`;
    case "generalist":
      return `Lead with the strongest overlap between ${strongestProfileSignal || "your profile"} and ${strongestCompanySignal || "the company's current needs"}.`;
  }
}

export function inferPitch(
  listing: ListingCandidate,
  profile: ProfileSummary,
): Pick<JobDecisionSnapshot, "pitchTheme" | "pitchAngle" | "pitchEvidence" | "strongestProfileSignal" | "strongestCompanySignal"> {
  const blob = `${listing.title} ${listing.description} ${listing.company} ${listing.department}`;
  const strongestProfileSignal = pickTopSignals(blob, profile.toolSignals, 1)[0] ?? profile.toolSignals[0] ?? "";
  const strongestCompanySignal =
    findFirstMatch(blob, [...AI_TERMS, ...DESIGN_TERMS, ...CODE_TERMS, ...STARTUP_TERMS]) ||
    findFirstMatch(blob, profile.toolSignals) ||
    listing.title;
  const pitchTheme = inferPitchTheme(listing, profile);
  const pitchEvidence = [
    ...pickTopSignals(blob, profile.toolSignals, 3),
    ...pickTopSignals(blob, [...STARTUP_TERMS, ...DESIGN_TERMS, ...AI_TERMS, ...CODE_TERMS], 3),
  ].filter(Boolean);

  return {
    pitchTheme,
    pitchAngle: angleForTheme(pitchTheme, listing.company || "the company", listing.title, strongestProfileSignal, strongestCompanySignal),
    pitchEvidence: [...new Set(pitchEvidence)].slice(0, 4),
    strongestProfileSignal,
    strongestCompanySignal,
  };
}
