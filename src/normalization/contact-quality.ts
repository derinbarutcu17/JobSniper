import type { ContactCandidate, ContactKind } from "../types.js";

export function isEmail(value: string): boolean {
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(value);
}

export function isPlaceholderEmail(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.endsWith("@example.com") ||
    lower.endsWith("@company.com") ||
    lower.includes("max.mustermann") ||
    lower.includes("john.doe") ||
    lower.includes("jane.doe") ||
    /^name@/i.test(lower) ||
    lower.includes("do-not-reply") ||
    lower.includes("noreply") ||
    lower.includes("no-reply") ||
    lower.endsWith("@yourdomain.com") ||
    lower.endsWith("@doe.com") ||
    lower.endsWith("@tech.com") ||
    lower.includes("sentry.io") ||
    lower.includes("@2x") ||
    /\.(png|jpg|jpeg|svg|webp|gif)$/i.test(lower)
  );
}

export function isWeakOutreachEmail(value: string): boolean {
  const localPart = value.toLowerCase().split("@")[0] ?? "";
  return /^(support|help|privacy|legal|security|abuse|billing|payment|press|media|ads|affiliate|offers|notification|notifications|accommodations?|reasonable-accommodations?|gdpr|datenschutz|compliance)$/.test(localPart);
}

function normalizedCompanyDomain(value: string): string {
  return value.toLowerCase().replace(/^www\./i, "");
}

function emailDomain(value: string): string {
  return normalizedCompanyDomain(value.split("@")[1] ?? "");
}

function kindWeight(kind: ContactKind): number {
  switch (kind) {
    case "founder_email":
      return 34;
    case "general_contact_email":
      return 30;
    case "recruiter_email":
      return 24;
    case "application_email":
      return 16;
    case "careers_email":
      return 14;
    case "linkedin_person":
      return 16;
    case "linkedin_company":
      return 12;
    case "team_page":
      return 11;
    case "contact_form":
      return 8;
    case "press_email":
      return -10;
    default:
      return 0;
  }
}

export function scoreContactCandidate(companyDomain: string, contact: ContactCandidate): number {
  const normalizedDomain = normalizedCompanyDomain(companyDomain);
  const email = contact.email.trim().toLowerCase();
  const sourceUrl = contact.sourceUrl.trim().toLowerCase();
  let score = kindWeight(contact.kind);

  if (email) {
    score += 20;
    const domain = emailDomain(email);
    if (normalizedDomain && domain === normalizedDomain) score += 18;
    if (normalizedDomain && domain && domain !== normalizedDomain) score -= 22;
    if (/^(hello|contact|info)@/.test(email)) score += 12;
    if (/^(founder|ceo|jobs|careers|talent|people|team)@/.test(email)) score += 9;
    if (isWeakOutreachEmail(email)) score -= 18;
    if (/^(security|abuse|compliance|gdpr|datenschutz)@/.test(email)) score -= 22;
    if (/noreply|no-reply|do-not-reply/.test(email)) score -= 40;
    if (domain && /(calendly\.com|zendesk\.com|hubspot|intercom|typeform\.com|heydata\.eu|greenhouse\.io|lever\.co)$/.test(domain)) {
      score -= 24;
    }
    if (contact.confidence === "high") score += 8;
    if (contact.confidence === "low") score -= 4;
    return score;
  }

  if (contact.linkedinUrl) {
    score += contact.kind === "linkedin_person" ? 8 : 4;
  }
  if (sourceUrl) {
    if (/\/(contact|imprint|legal|privacy)(\/|$)/.test(sourceUrl)) score += 14;
    else if (/\/(team|leadership|founders?)(\/|$)/.test(sourceUrl)) score += 12;
    else if (/\/(careers?|jobs?|join)(\/|$)/.test(sourceUrl)) score += 8;
    else score += 2;
  }

  return score;
}

export function isStrongDirectEmail(companyDomain: string, contact: ContactCandidate): boolean {
  return Boolean(contact.email) && scoreContactCandidate(companyDomain, contact) >= 54;
}

export function isUsableDirectEmail(companyDomain: string, contact: ContactCandidate): boolean {
  return Boolean(contact.email) && scoreContactCandidate(companyDomain, contact) >= 42;
}
