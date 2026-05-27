import { slugify } from "../lib/text.js";
import type { ConfidenceLabel } from "./daily-types.js";

interface RuleResult {
  accepted: boolean;
  score: number;
  reasons: string[];
  warnings: string[];
  rejectReason?: string;
}

function normalize(input: string): string {
  return input.toLowerCase().replace(/\s+/g, " ").trim();
}

export function normalizeRoleTitle(title: string): string {
  return normalize(
    title
      .replace(/\(.*?m\/f\/d.*?\)/gi, " ")
      .replace(/\b(m\/f\/d|f\/m\/d|w\/m\/d)\b/gi, " ")
      .replace(/\bberlin\b.*$/i, " ")
      .replace(/[|,/]+/g, " ")
      .replace(/\bux\s*\/\s*ui\b/gi, "ux ui")
      .replace(/[^\w\s-]/g, " "),
  );
}

function containsAny(blob: string, terms: string[]): boolean {
  return terms.some((term) => blob.includes(term));
}

function isSmallTeamContext(blob: string): boolean {
  return containsAny(blob, [
    "startup",
    "small team",
    "hands-on",
    "hands on",
    "founding",
    "first designer",
    "studio",
    "agency",
    "early stage",
    "seed",
    "pre-seed",
    "generalist",
    "0-1",
    "0 to 1",
  ]);
}

export function classifyRole(title: string, description = "", companyType = ""): RuleResult {
  const normalizedTitle = normalizeRoleTitle(title);
  const blob = normalize(`${title} ${description} ${companyType}`);
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (containsAny(blob, ["backend engineer", "backend developer", "devops", "site reliability", "ml engineer", "machine learning", "data scientist", "data engineer", "platform engineer", "cloud engineer", "customer success", "sales"])) {
    return { accepted: false, score: 0, reasons, warnings, rejectReason: "role family is out of scope" };
  }

  if (containsAny(normalizedTitle, ["senior product designer", "senior ux ui designer", "staff designer", "director of design", "vp design"])) {
    return { accepted: false, score: 0, reasons, warnings, rejectReason: "senior design leadership role" };
  }

  if (normalizedTitle.includes("principal")) {
    if (!isSmallTeamContext(blob)) {
      return { accepted: false, score: 0, reasons, warnings, rejectReason: "principal role without startup context" };
    }
    warnings.push("principal title is stretchy even with startup context");
  }

  if (normalizedTitle.includes("lead designer")) {
    if (!isSmallTeamContext(blob)) {
      return { accepted: false, score: 0, reasons, warnings, rejectReason: "lead designer without small-team context" };
    }
    reasons.push("lead role is paired with startup or studio context");
    return { accepted: true, score: 84, reasons, warnings };
  }

  if (normalizedTitle.includes("head of design")) {
    if (!isSmallTeamContext(blob)) {
      return { accepted: false, score: 0, reasons, warnings, rejectReason: "head of design without hands-on startup context" };
    }
    reasons.push("hands-on first-design leader context keeps this in scope");
    return { accepted: true, score: 82, reasons, warnings };
  }

  if (containsAny(normalizedTitle, ["product designer", "ux ui designer", "ui designer", "ux designer", "visual designer", "design engineer", "ux engineer", "creative technologist", "presentation designer", "design systems designer", "junior product manager"])) {
      reasons.push("title is directly within the target role families");
    return { accepted: true, score: 90, reasons, warnings };
  }

  if (containsAny(normalizedTitle, ["frontend developer", "frontend engineer"])) {
    const goodSignals = [
      "ui",
      "ux",
      "interface",
      "design systems",
      "react",
      "tailwind",
      "figma",
      "component library",
      "product design",
      "frontend prototyping",
      "creative coding",
      "visual polish",
    ];
    const badSignals = [
      "backend ownership",
      "microservices",
      "kubernetes",
      "cloud infrastructure",
      "devops",
      "data pipelines",
      "api architecture",
      "distributed systems",
    ];
    if (containsAny(blob, badSignals)) {
      return { accepted: false, score: 0, reasons, warnings, rejectReason: "frontend role is backend-heavy" };
    }
    if (containsAny(blob, goodSignals)) {
      reasons.push("frontend role is clearly UI or product heavy");
      return { accepted: true, score: 78, reasons, warnings };
    }
    return { accepted: false, score: 0, reasons, warnings, rejectReason: "frontend role lacks design-heavy signals" };
  }

  return { accepted: false, score: 0, reasons, warnings, rejectReason: "title is outside the target families" };
}

export function classifyLocation(location: string, workModel = "", description = ""): RuleResult {
  const blob = normalize(`${location} ${workModel} ${description}`);
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (containsAny(blob, ["turkey", "istanbul", "ankara"])) {
    return { accepted: false, score: 0, reasons, warnings, rejectReason: "location is in Turkey" };
  }
  if (containsAny(blob, ["united states", "us only", "usa only", "uk only", "canada only"])) {
    return { accepted: false, score: 0, reasons, warnings, rejectReason: "remote scope is not Germany-compatible" };
  }
  if (blob.includes("berlin")) {
    reasons.push("Berlin-based role");
    return { accepted: true, score: 92, reasons, warnings };
  }
  if (blob.includes("germany") && (blob.includes("remote") || blob.includes("hybrid"))) {
    reasons.push("Germany-compatible remote or hybrid role");
    return { accepted: true, score: 82, reasons, warnings };
  }
  if (blob.includes("remote germany")) {
    reasons.push("Germany remote role");
    return { accepted: true, score: 84, reasons, warnings };
  }
  if (blob.includes("europe remote")) {
    reasons.push("Europe remote may be Germany-compatible");
    warnings.push("Germany compatibility is not explicit");
    return { accepted: true, score: 58, reasons, warnings };
  }
  if (blob.includes("worldwide remote")) {
    warnings.push("worldwide remote is vague for Germany eligibility");
    return { accepted: true, score: 45, reasons, warnings };
  }
  if (blob.includes("remote")) {
    warnings.push("remote scope is unclear");
    return { accepted: true, score: 52, reasons, warnings };
  }
  if (containsAny(blob, ["munich", "hamburg", "cologne", "frankfurt"])) {
    return { accepted: false, score: 0, reasons, warnings, rejectReason: "onsite role is outside Berlin" };
  }
  return { accepted: false, score: 0, reasons, warnings, rejectReason: "location is outside target geography" };
}

export function classifyLanguage(language: string, description = ""): RuleResult {
  const blob = normalize(`${language} ${description}`);
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (containsAny(blob, ["c1 german", "native german", "deutsch auf muttersprachniveau", "verhandlungssicheres deutsch", "fluent german mandatory", "german required"])) {
    return { accepted: false, score: 0, reasons, warnings, rejectReason: "German requirement is too strong" };
  }
  if (containsAny(blob, ["english working language", "english accepted", "international team"])) {
    reasons.push("English-friendly working environment");
    return { accepted: true, score: 90, reasons, warnings };
  }
  if (blob.includes("german nice to have")) {
    reasons.push("German is only a nice-to-have");
    return { accepted: true, score: 75, reasons, warnings };
  }
  if (blob.includes("german")) {
    warnings.push("German-language post without explicit requirement");
    return { accepted: true, score: 55, reasons, warnings };
  }
  return { accepted: true, score: 70, reasons: ["No strong language blocker found"], warnings };
}

export function toConfidenceLabel(score: number): ConfidenceLabel {
  if (score >= 85) return "high";
  if (score >= 70) return "good";
  if (score >= 50) return "maybe";
  return "low";
}

export function summarizeRuleSet(parts: RuleResult[]): RuleResult {
  const rejected = parts.find((part) => !part.accepted);
  if (rejected) {
    return rejected;
  }
  return {
    accepted: true,
    score: Math.round(parts.reduce((sum, part) => sum + part.score, 0) / Math.max(parts.length, 1)),
    reasons: parts.flatMap((part) => part.reasons),
    warnings: parts.flatMap((part) => part.warnings),
  };
}

export function buildCompanyTypeHint(name: string, description: string): string {
  const blob = normalize(`${name} ${description}`);
  if (containsAny(blob, ["studio", "agency"])) return "studio_or_agency";
  if (containsAny(blob, ["startup", "seed", "pre-seed", "series a", "founding"])) return "startup";
  if (containsAny(blob, ["enterprise", "corporate"])) return "corporate";
  return "product_company";
}

export function companySignalKey(value: string): string {
  return slugify(normalize(value));
}
