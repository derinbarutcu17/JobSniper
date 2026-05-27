import { domainFromUrl, normalizeUrl } from "../lib/url.js";

const CAREER_SUBDOMAINS = ["www", "jobs", "careers", "app"];
const ATS_HOSTS = new Set([
  "jobs.ashbyhq.com",
  "boards.greenhouse.io",
  "apply.workable.com",
  "jobs.lever.co",
  "join.com",
  "smartrecruiters.com",
  "bamboohr.com",
  "recruitee.com",
  "workday.com",
  "myworkdayjobs.com",
]);

function normalizeWhitespace(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function normalizeCompanyDomain(input: {
  domain?: string;
  website?: string;
  email?: string;
  applyUrl?: string;
  jobUrl?: string;
}): string {
  const explicit = normalizeHost(input.domain ?? "");
  if (explicit && explicit.includes(".") && !ATS_HOSTS.has(explicit)) {
    return explicit;
  }

  const emailDomain = normalizeEmailDomain(input.email ?? "");
  if (emailDomain) {
    return emailDomain;
  }

  for (const url of [input.website, input.applyUrl, input.jobUrl]) {
    const rawHost = domainFromUrl(url ?? "").toLowerCase();
    if (ATS_HOSTS.has(rawHost)) {
      const slug = inferAtsSlug(url ?? "");
      if (slug) return slug;
      continue;
    }
    const normalized = normalizeHost(rawHost);
    if (!normalized) continue;
    return normalized;
  }

  return explicit;
}

function normalizeHost(host: string): string {
  const clean = host.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  if (!clean) return "";
  const parts = clean.split(".").filter(Boolean);
  while (parts.length > 2 && CAREER_SUBDOMAINS.includes(parts[0]!)) {
    parts.shift();
  }
  return parts.join(".");
}

function normalizeEmailDomain(email: string): string {
  const atIndex = email.indexOf("@");
  if (atIndex === -1) return "";
  return normalizeHost(email.slice(atIndex + 1));
}

function inferAtsSlug(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/^\/+/, "");
    if (parsed.hostname === "jobs.ashbyhq.com") {
      return pathname.split("/")[0] ?? "";
    }
    if (parsed.hostname === "boards.greenhouse.io") {
      return pathname.split("/")[0] ?? "";
    }
    if (parsed.hostname === "jobs.lever.co") {
      return pathname.split("/")[0] ?? "";
    }
    if (parsed.hostname === "apply.workable.com") {
      return pathname.split("/")[0] ?? "";
    }
    return "";
  } catch {
    return "";
  }
}

export function normalizeJobTitle(title: string): string {
  return normalizeWhitespace(
    title
      .replace(/\(.*?m\/f\/d.*?\)/gi, " ")
      .replace(/\b(m\/f\/d|f\/m\/d|w\/m\/d)\b/gi, " ")
      .replace(/\bux\s*\/\s*ui\b/gi, "ux ui")
      .replace(/[|,/]+/g, " ")
      .replace(/[^\w\s-]/g, " ")
      .replace(/\bberlin\b.*$/i, " ")
      .replace(/\s+-\s*$/g, " "),
  );
}

export function canonicalJobIdentity(input: {
  companyDomain?: string;
  companyName?: string;
  title: string;
  applyUrl?: string;
  jobUrl?: string;
  source?: string;
}): string {
  const domain = normalizeCompanyDomain({
    domain: input.companyDomain,
    applyUrl: input.applyUrl,
    jobUrl: input.jobUrl,
  });
  const title = normalizeJobTitle(input.title);
  const canonicalUrl = normalizeUrl(input.applyUrl || input.jobUrl || "");
  if (domain && title) {
    return `${domain}::${title}`;
  }
  return `${normalizeWhitespace(input.companyName ?? "")}::${title}::${normalizeWhitespace(input.source ?? "")}::${canonicalUrl}`;
}

export function canonicalContactIdentity(input: {
  companyDomain?: string;
  type: string;
  value: string;
}): string {
  const domain = normalizeCompanyDomain({ domain: input.companyDomain, email: input.value });
  return `${domain}::${normalizeWhitespace(input.type)}::${normalizeWhitespace(input.value)}`;
}
