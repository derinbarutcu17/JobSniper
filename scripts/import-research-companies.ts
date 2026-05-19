import fs from "node:fs";
import path from "node:path";
import pdf from "pdf-parse";
import { openDatabase, upsertCompany, upsertContact } from "../src/state/db.ts";
import { canonicalCompanyKey, canonicalContactKey, domainFromUrl } from "../src/lib/url.ts";
import type { CompanyRecordInput, ContactKind, PitchTheme, RecommendedRoute } from "../src/types.ts";

type ResearchRow = {
  company_name: string;
  website: string;
  berlin_relevance: string;
  company_type: string;
  stage_estimate: string;
  fit_reason: string;
  best_route: string;
  public_contact_surface: string;
  priority_score: string;
  notes: string;
};

const EXPECTED_HEADERS = [
  "company_name",
  "website",
  "berlin_relevance",
  "company_type",
  "stage_estimate",
  "fit_reason",
  "best_route",
  "public_contact_surface",
  "priority_score",
  "notes",
] as const;

function usage(): never {
  console.error("Usage: npx tsx scripts/import-research-companies.ts <pdf-or-txt-path> [more-paths...]");
  process.exit(1);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
}

function loadSourceText(filePath: string): Promise<string> | string {
  const resolved = path.resolve(filePath);
  const buffer = fs.readFileSync(resolved);
  if (resolved.toLowerCase().endsWith(".pdf")) {
    return pdf(buffer).then((result) => result.text);
  }
  return buffer.toString("utf8");
}

function extractImportBlock(text: string): string {
  const headerPattern = /company_name\s*,\s*website\s*,\s*berlin_relevance\s*,\s*company_type\s*,\s*stage_estimate\s*,\s*fit_reason\s*,\s*best_route\s*,\s*public_contact_surface\s*,\s*priority_score\s*,\s*notes/i;
  const match = text.match(headerPattern);
  if (match?.index === undefined) {
    throw new Error("Could not find research import CSV header in source document.");
  }
  const tail = text.slice(match.index);
  const endMatch = tail.match(/Open questions and limits|Works cited/i);
  const endMarker = endMatch?.index ?? -1;
  return endMarker === -1 ? tail : tail.slice(0, endMarker);
}

function parseCsvBlock(block: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < block.length; index += 1) {
    const char = block[index]!;
    const next = block[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      cell = "";
      if (row.some((entry) => entry.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((entry) => entry.trim().length > 0)) {
      rows.push(row);
    }
  }

  return rows;
}

function rowsFromText(text: string): ResearchRow[] {
  const csvRows = parseCsvBlock(extractImportBlock(text));
  const [header, ...dataRows] = csvRows;
  if (!header) {
    throw new Error("Research import block was empty.");
  }
  const normalizedHeader = header.map((entry) => normalizeWhitespace(entry));
  if (EXPECTED_HEADERS.some((value, index) => normalizedHeader[index] !== value)) {
    throw new Error(`Unexpected research header: ${normalizedHeader.join(" | ")}`);
  }

  return dataRows
    .filter((row) => row.length >= EXPECTED_HEADERS.length)
    .map((row) => {
      const values = row.slice(0, EXPECTED_HEADERS.length).map((entry) => normalizeWhitespace(entry));
      return Object.fromEntries(EXPECTED_HEADERS.map((key, index) => [key, values[index] ?? ""])) as ResearchRow;
    });
}

function ensureUrl(value: string): string {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value)) return "";
  return `https://${value.replace(/\s+/g, "")}`;
}

function routeToRecommendation(value: string): CompanyRecordInput["recommendation"] {
  if (value === "apply_now") return "apply_now";
  if (value === "cold_email" || value === "founder_outreach") return "cold_email";
  return "watch";
}

function routeToBestRoute(value: string, surface: string): RecommendedRoute {
  if (value === "founder_outreach") return "founder_or_team_reachout";
  if (value === "cold_email") return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(surface) ? "direct_email_first" : "watch_company";
  if (value === "apply_now") return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(surface) ? "direct_email_first" : "ats_only";
  return "watch_company";
}

function inferPitchTheme(text: string): PitchTheme {
  const blob = text.toLowerCase();
  if (/(ai|agent|automation|workflow|llm|voice|genai)/.test(blob)) return "ai_workflows";
  if (/(design engineer|design-engineer|designer-builder|builder|frontend|full stack|fullstack|developer ux|devx)/.test(blob)) {
    return "design_engineering";
  }
  if (/(startup|seed|pre-seed|founding|small team)/.test(blob)) return "startup_speed";
  if (/(trust|compliance|clarity|complex|systems|workflow|information architecture)/.test(blob)) return "systems_thinking";
  if (/(brand|visual|creative|ux|ui|product design)/.test(blob)) return "design";
  return "generalist";
}

function inferPitchAngle(companyName: string, fitReason: string): string {
  return `Lead with ${fitReason.replace(/\.$/, "")} for ${companyName}.`;
}

function priorityBand(score: number): CompanyRecordInput["priorityBand"] {
  if (score >= 8) return "high";
  if (score >= 6) return "medium";
  return "low";
}

function startupScore(stage: string, companyType: string): number {
  const normalizedStage = stage.toLowerCase();
  const normalizedType = companyType.toLowerCase();
  if (normalizedStage === "pre-seed") return 18;
  if (normalizedStage === "seed") return 16;
  if (normalizedStage === "series a") return 14;
  if (normalizedType.includes("startup")) return 12;
  if (normalizedType.includes("scale-up")) return 8;
  return 4;
}

function contactabilityScore(surface: string): number {
  if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(surface)) return 16;
  if (/\/(contact|team|about|founders?|jobs?|careers?)(\/|$)/i.test(surface)) return 8;
  if (surface.startsWith("http")) return 6;
  return 0;
}

function companyFitScore(priority: number): number {
  return Math.max(6, Math.min(18, priority * 2));
}

function hiringSignalScore(bestRoute: string, surface: string): number {
  if (bestRoute === "apply_now") return 12;
  if (/\/(jobs?|careers?)(\/|$)/i.test(surface)) return 10;
  if (bestRoute === "cold_email" || bestRoute === "founder_outreach") return 8;
  return 5;
}

function toContactKind(route: string, email: string): ContactKind {
  if (/^(founder|ceo|cofounder)/i.test(email) || route === "founder_outreach") return "founder_email";
  if (/^(jobs|careers|talent|people)/i.test(email)) return "application_email";
  return "general_contact_email";
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) usage();

  const baseDir = path.resolve("/Users/derin/Desktop/CODING/Job sniper");
  const { db } = openDatabase(baseDir);
  const timestamp = new Date().toISOString();
  const seen = new Set<string>();

  let importedCompanies = 0;
  let importedContacts = 0;
  let skippedDuplicates = 0;

  for (const sourcePath of args) {
    const text = await loadSourceText(sourcePath);
    const rows = rowsFromText(text);
    const sourceLabel = path.basename(sourcePath);

    for (const row of rows) {
      const companyUrl = ensureUrl(row.website);
      const companyDomain = domainFromUrl(companyUrl);
      const canonicalKey = canonicalCompanyKey(row.company_name, companyDomain);
      if (seen.has(canonicalKey)) {
        skippedDuplicates += 1;
        continue;
      }
      seen.add(canonicalKey);

      const surface = row.public_contact_surface.replace(/\s+/g, "");
      const surfaceUrl = ensureUrl(surface);
      const priority = Number(row.priority_score) || 0;
      const route = row.best_route;
      const description = normalizeWhitespace(`${row.fit_reason}. ${row.notes}`);
      const theme = inferPitchTheme(`${row.fit_reason} ${row.notes}`);
      const isStartupCandidate = /startup|scale-up/i.test(row.company_type) || /pre-seed|seed|series a|growth/i.test(row.stage_estimate);
      const sourceUrls = [companyUrl, surfaceUrl].filter(Boolean);
      const startupSignals = [row.company_type, row.stage_estimate, row.berlin_relevance, "research_pdf_import"].filter(Boolean);
      const hiringSignals = [route, surfaceUrl ? "public_contact_surface" : ""].filter(Boolean);

      const companyInput: CompanyRecordInput = {
        canonicalKey,
        name: row.company_name,
        domain: companyDomain,
        location: row.berlin_relevance,
        companyUrl,
        careersUrl: /\/(jobs?|careers?)(\/|$)/i.test(surfaceUrl) ? surfaceUrl : "",
        aboutUrl: /\/about(\/|$)/i.test(surfaceUrl) ? surfaceUrl : "",
        teamUrl: /\/(team|founders?|leadership)(\/|$)/i.test(surfaceUrl) ? surfaceUrl : "",
        contactUrl:
          /\/(contact|imprint|legal|privacy)(\/|$)/i.test(surfaceUrl) ? surfaceUrl : /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(surface) ? companyUrl : "",
        pressUrl: "",
        linkedinUrl: /linkedin\.com/i.test(surfaceUrl) ? surfaceUrl : "",
        description,
        sourceUrls: [...new Set([`research:${sourceLabel}`, ...sourceUrls])],
        publicContacts: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(surface) ? [surface.toLowerCase()] : [],
        startupSignals,
        hiringSignals,
        founderNames: [],
        cities: row.berlin_relevance.toLowerCase().includes("berlin") ? ["Berlin"] : [],
        sizeBand: "",
        stageText: row.stage_estimate,
        remotePolicy: "",
        openRoleCount: route === "apply_now" ? 1 : 0,
        startupScore: startupScore(row.stage_estimate, row.company_type),
        companyFitScore: companyFitScore(priority),
        hiringSignalScore: hiringSignalScore(route, surfaceUrl),
        contactabilityScore: contactabilityScore(surface),
        isStartupCandidate,
        recommendation: routeToRecommendation(route),
        recommendationReason: normalizeWhitespace(`${row.fit_reason}. ${row.notes}`),
        bestRoute: routeToBestRoute(route, surface),
        pitchTheme: theme,
        pitchAngle: inferPitchAngle(row.company_name, row.fit_reason),
        pitchEvidence: [row.fit_reason, row.notes].map(normalizeWhitespace),
        directContactCount: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(surface) ? 1 : 0,
        reachableNow: Boolean(surface),
        priorityBand: priorityBand(priority),
        lastSeenAt: timestamp,
      };

      upsertCompany(db, companyInput);
      importedCompanies += 1;

      if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(surface)) {
        upsertContact(db, {
          canonicalKey: canonicalContactKey(surface.toLowerCase(), "", `${row.company_name}:${surface.toLowerCase()}`, canonicalKey),
          companyCanonicalKey: canonicalKey,
          name: "",
          title: "",
          email: surface.toLowerCase(),
          sourceUrl: companyUrl,
          linkedinUrl: "",
          contactKind: toContactKind(route, surface.toLowerCase()),
          notes: sourceLabel,
          confidence: "high",
          evidenceType: "research_pdf",
          evidenceExcerpt: `Imported from ${sourceLabel}`,
          isPublic: true,
          lastVerifiedAt: timestamp,
          pageType: "generic",
          lastSeenAt: timestamp,
        });
        importedContacts += 1;
      }
    }
  }

  console.log(JSON.stringify({ importedCompanies, importedContacts, skippedDuplicates }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
