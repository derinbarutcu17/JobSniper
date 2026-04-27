import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import pdf from "pdf-parse";
import { defaultConfig, loadConfig } from "./config.js";
import { resolveProfilePath } from "../lib/paths.js";
import { extractYearRequirement, findFirstMatch, includesAny, normalizeText, pickTopSignals, summarizeToLine } from "../lib/text.js";
import { collectProfileSignals, getEnabledRolePackIds, getRolePack } from "./role-packs.js";
import type { ProfileSummary, SeniorityTarget, SniperConfig } from "../types.js";

const NEGATED_SENIORITY_PATTERNS = [
  /no\s+(senior|lead|manager|director|head|principal|staff)\s+roles?/i,
  /(junior|entry[- ]level|associate|intern)\s+(only|roles?)/i,
  /(no|without)\s+(lead|managerial|management)\s+roles?/i,
];

const POSITIVE_SENIORITY_PATTERNS: Array<{ level: SeniorityTarget; pattern: RegExp }> = [
  { level: "senior", pattern: /\b(senior|principal|staff|lead)\s+(product|ux|ui|software|frontend|ai|design|creative|automation|engineer|designer)/i },
  { level: "mid", pattern: /\b(mid|intermediate)\s+(product|ux|ui|software|frontend|ai|design|creative|automation|engineer|designer)/i },
  { level: "junior", pattern: /\b(junior|associate|graduate)\s+(product|ux|ui|software|frontend|ai|design|creative|automation|engineer|designer)/i },
  { level: "intern", pattern: /\b(intern|internship|trainee|staj)\b/i },
];

const TITLE_AVOID_TERMS = ["senior", "lead", "manager", "director", "head", "principal", "staff"];

function looksLikeFilePath(input: string): boolean {
  const hasWhitespace = /\s/.test(input);
  return (
    input.startsWith("/") ||
    input.startsWith("./") ||
    input.startsWith("../") ||
    (!hasWhitespace && /[\\/]/.test(input)) ||
    (!hasWhitespace && /\.(pdf|txt|md|doc|docx)$/i.test(input))
  );
}

function looksLikeUrl(input: string): boolean {
  return /^https?:\/\//i.test(input.trim());
}

async function readUrlContent(input: string): Promise<string> {
  const response = await fetch(input, {
    headers: {
      "user-agent": "job-sniper/1.0 (+portfolio onboarding)",
      accept: "text/html,application/json,text/plain;q=0.9,*/*;q=0.8",
    },
  });
  if (!response.ok) {
    throw new Error(`Profile URL fetch failed with ${response.status}: ${input}`);
  }
  const body = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (!/html/i.test(contentType)) {
    return body.trim();
  }
  const $ = cheerio.load(body);
  const title = $("title").text().trim();
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() ?? "";
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  return [title, metaDescription, bodyText].filter(Boolean).join("\n").trim();
}

async function readProfileInput(input: string): Promise<string> {
  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  if (fs.existsSync(trimmed) && fs.lstatSync(trimmed).isFile()) {
    const extension = path.extname(trimmed).toLowerCase();
    if (extension === ".pdf") {
      const buffer = fs.readFileSync(trimmed);
      const parsed = await pdf(buffer);
      return parsed.text.trim();
    }
    return fs.readFileSync(trimmed, "utf8").trim();
  }

  if (looksLikeUrl(trimmed)) {
    return readUrlContent(trimmed);
  }

  if (looksLikeFilePath(trimmed)) {
    throw new Error(`Profile file was not found: ${trimmed}`);
  }

  return trimmed;
}

function deriveTargetSeniority(content: string): {
  targetSeniority: SeniorityTarget;
  allowStretchRoles: boolean;
  avoidTitleTerms: string[];
} {
  const normalized = normalizeText(content);
  const yearRequirement = extractYearRequirement(content);
  const years = yearRequirement ? Number.parseInt(yearRequirement, 10) : 0;

  if (NEGATED_SENIORITY_PATTERNS.some((pattern) => pattern.test(content))) {
    return {
      targetSeniority: includesAny(normalized, ["intern", "internship", "staj"]) ? "intern" : "junior",
      allowStretchRoles: false,
      avoidTitleTerms: TITLE_AVOID_TERMS,
    };
  }

  for (const entry of POSITIVE_SENIORITY_PATTERNS) {
    if (entry.pattern.test(content)) {
      return {
        targetSeniority: entry.level,
        allowStretchRoles: entry.level === "mid" || entry.level === "senior",
        avoidTitleTerms: entry.level === "senior" ? [] : TITLE_AVOID_TERMS,
      };
    }
  }

  if (includesAny(normalized, ["master's", "masters", "graduate", "student", "thesis"])) {
    return {
      targetSeniority: "junior",
      allowStretchRoles: false,
      avoidTitleTerms: TITLE_AVOID_TERMS,
    };
  }

  if (years >= 5 || includesAny(normalized, ["leading teams", "team lead", "managed a team"])) {
    return {
      targetSeniority: "senior",
      allowStretchRoles: true,
      avoidTitleTerms: [],
    };
  }

  if (years >= 2) {
    return {
      targetSeniority: "mid",
      allowStretchRoles: true,
      avoidTitleTerms: TITLE_AVOID_TERMS.filter((term) => term !== "lead"),
    };
  }

  return {
    targetSeniority: includesAny(normalized, ["intern", "internship", "staj"]) ? "intern" : "junior",
    allowStretchRoles: false,
    avoidTitleTerms: TITLE_AVOID_TERMS,
  };
}

export function deriveProfileSummary(content: string, config: SniperConfig = defaultConfig): ProfileSummary {
  const normalized = normalizeText(content);
  const roleFamilies: string[] = [];

  for (const lane of getEnabledRolePackIds(config)) {
    const pack = getRolePack(config, lane);
    const signals = pack ? [...(pack.profileSignals ?? []), ...pack.keywords] : [];
    if (signals.length && includesAny(normalized, signals)) {
      roleFamilies.push(lane);
    }
  }
  if (roleFamilies.length === 0) {
    roleFamilies.push("generalist");
  }

  const seniority = deriveTargetSeniority(content);
  const preferredLocations = [
    ...(includesAny(normalized, ["berlin"]) ? ["Berlin"] : []),
    ...(includesAny(normalized, ["remote", "uzaktan"]) ? ["Remote"] : []),
  ];

  const languagePreference = [
    ...(includesAny(normalized, ["german", "deutsch"]) ? ["de"] : []),
    ...(includesAny(normalized, ["english", "ingilizce"]) ? ["en"] : []),
  ];

  const toolSignals = pickTopSignals(normalized, collectProfileSignals(config), 10);

  const focusHint = findFirstMatch(
    normalized,
    collectProfileSignals(config),
  );

  return {
    roleFamilies,
    targetSeniority: seniority.targetSeniority,
    allowStretchRoles: seniority.allowStretchRoles,
    avoidTitleTerms: seniority.avoidTitleTerms,
    preferredLocations,
    languagePreference: languagePreference.length ? languagePreference : ["en", "de"],
    toolSignals: [...new Set(toolSignals)],
    summary: summarizeToLine(`${focusHint ? `${focusHint}. ` : ""}${content}`, 400),
  };
}

export async function onboardProfile(
  baseDir: string,
  input: string,
): Promise<{ cvText: string; profile: ProfileSummary }> {
  const content = await readProfileInput(input);
  if (!content.trim()) {
    throw new Error("No CV content provided. Pass text, pipe stdin, or give a file path.");
  }

  const cvPath = resolveProfilePath(baseDir, "cv.md");
  const profilePath = resolveProfilePath(baseDir, "profile.json");
  fs.writeFileSync(cvPath, `${content.trim()}\n`);

  const profile = deriveProfileSummary(content, loadConfig(baseDir));
  fs.writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);

  return { cvText: content, profile };
}

export function loadProfile(baseDir: string): { cvText: string; profile: ProfileSummary } {
  const cvPath = resolveProfilePath(baseDir, "cv.md");
  const profilePath = resolveProfilePath(baseDir, "profile.json");

  if (!fs.existsSync(cvPath)) {
    throw new Error("No profile found. Run `onboard` first with CV text or a file path.");
  }

  const cvText = fs.readFileSync(cvPath, "utf8");
  if (fs.existsSync(profilePath)) {
    return {
      cvText,
      profile: JSON.parse(fs.readFileSync(profilePath, "utf8")) as ProfileSummary,
    };
  }

  const profile = deriveProfileSummary(cvText, loadConfig(baseDir));
  fs.writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
  return { cvText, profile };
}
