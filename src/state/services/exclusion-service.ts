import fs from "node:fs";
import path from "node:path";
import { openDatabase } from "../db.js";
import { normalizeCompanyToken } from "../../normalization/tomorrow-sourcing.js";
import type { DatabaseBundle } from "../db.js";

export interface ExclusionSet {
  companies: Set<string>;
  domains: Set<string>;
  urls: Set<string>;
}

function parseBulletCompany(line: string): string {
  return line
    .replace(/^\s*-\s*/, "")
    .replace(/\s+-\s+`.*$/, "")
    .trim();
}

export function loadHumanExclusions(baseDir: string): ExclusionSet {
  const workspaceRoot = path.resolve(baseDir, "..");
  const files = [
    { path: path.join(workspaceRoot, "memory", "job-search-source-of-truth.md"), section: "## Already Applied / Contacted" },
    { path: path.join(workspaceRoot, "memory", "sent-emails.md"), section: "## Applied / Already Reached" },
  ];

  const companies = new Set<string>();
  for (const item of files) {
    if (!fs.existsSync(item.path)) continue;
    const lines = fs.readFileSync(item.path, "utf8").split(/\r?\n/);
    let inSection = false;
    for (const line of lines) {
      if (line.startsWith("## ")) {
        inSection = line.trim() === item.section;
        continue;
      }
      if (!inSection) continue;
      if (!line.trim().startsWith("- ")) continue;
      const company = parseBulletCompany(line);
      if (company) companies.add(normalizeCompanyToken(company));
    }
  }

  const seedPath = path.join(baseDir, "data", "contacted-company-seed.json");
  if (fs.existsSync(seedPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(seedPath, "utf8")) as { companies?: string[] };
      for (const c of data.companies ?? []) {
        if (c) companies.add(normalizeCompanyToken(c));
      }
    } catch {
      // ignore
    }
  }

  return { companies, domains: new Set(), urls: new Set() };
}

export function loadDbExclusions(bundle: DatabaseBundle): ExclusionSet {
  const { db } = bundle;
  const companies = new Set<string>();
  const domains = new Set<string>();
  const urls = new Set<string>();

  const companyRows = db.prepare(`
    SELECT canonical_key, domain, company_url, careers_url
    FROM companies c
    JOIN company_outreach_state cos ON c.id = cos.company_id
    WHERE cos.status IN ('reached','sent_email','talking','rejected','archived','applied')
  `).all() as Array<Record<string, unknown>>;

  for (const row of companyRows) {
    const key = String(row.canonical_key ?? "").toLowerCase();
    const domain = String(row.domain ?? "").toLowerCase();
    if (key) companies.add(normalizeCompanyToken(key));
    if (domain) domains.add(domain);
    for (const urlField of [row.company_url, row.careers_url]) {
      const url = String(urlField ?? "").toLowerCase();
      if (url) urls.add(url);
    }
  }

  const jobRows = db.prepare(`
    SELECT canonical_key, url, apply_url, company_name
    FROM jobs
    WHERE pipeline_status IN ('applied','contacted','reply_received','interviewing','rejected','archived')
  `).all() as Array<Record<string, unknown>>;

  for (const row of jobRows) {
    const key = String(row.canonical_key ?? "").toLowerCase();
    const companyName = String(row.company_name ?? "").toLowerCase();
    if (key) companies.add(normalizeCompanyToken(key));
    if (companyName) companies.add(normalizeCompanyToken(companyName));
    for (const urlField of [row.url, row.apply_url]) {
      const url = String(urlField ?? "").toLowerCase();
      if (url) urls.add(url);
    }
  }

  return { companies, domains, urls };
}

export function buildExclusionSet(baseDir: string): ExclusionSet {
  const human = loadHumanExclusions(baseDir);
  const { db } = openDatabase(baseDir);
  const dbExclusions = loadDbExclusions({ db, baseDir });

  return {
    companies: new Set([...human.companies, ...dbExclusions.companies]),
    domains: new Set([...human.domains, ...dbExclusions.domains]),
    urls: new Set([...human.urls, ...dbExclusions.urls]),
  };
}

export function isExcluded(
  exclusionSet: ExclusionSet,
  canonicalKey: string,
  companyName: string,
  domain: string,
  url: string,
): boolean {
  const normalizedKey = normalizeCompanyToken(canonicalKey);
  const normalizedName = normalizeCompanyToken(companyName);
  const normalizedDomain = domain.toLowerCase().replace(/^www\./, "");
  const normalizedUrl = url.toLowerCase();

  if (exclusionSet.companies.has(normalizedKey)) return true;
  if (exclusionSet.companies.has(normalizedName)) return true;
  if (exclusionSet.domains.has(normalizedDomain)) return true;
  if (exclusionSet.urls.has(normalizedUrl)) return true;

  return false;
}
