import { includesAny, uniqueNonEmpty } from "../../lib/text.js";
import { domainFromUrl } from "../../lib/url.js";
import { filterKnownInvalidContacts } from "../../lib/contact-memory.js";
import type { CompanyRecordInput, ContactCandidate, ListingCandidate, PageRecord } from "../../types.js";

export function companyFromListing(listing: ListingCandidate): CompanyRecordInput {
  const startupSignals = uniqueNonEmpty(
    [
      ...(includesAny(listing.description, ["seed", "series a", "founding", "small team"]) ? ["startup_language"] : []),
      ...(listing.titleFamily === "Design Engineer" || listing.titleFamily === "AI Engineer" ? ["modern_team"] : []),
    ],
  );
  const hiringSignals = uniqueNonEmpty(
    [
      ...(listing.isRealJobPage ? ["real_job_page"] : []),
      ...(listing.postedAt ? ["fresh_posting"] : []),
      ...(listing.publicContacts.length ? ["public_contact_surface"] : []),
    ],
  );
  return {
    canonicalKey: "",
    name: listing.company,
    domain: domainFromUrl(listing.companyUrl || listing.url),
    location: listing.location || listing.country,
    companyUrl: listing.companyUrl,
    careersUrl: listing.careersUrl,
    aboutUrl: listing.aboutUrl,
    teamUrl: listing.teamUrl,
    contactUrl: listing.contactUrl,
    pressUrl: listing.pressUrl,
    linkedinUrl: listing.companyLinkedinUrl,
    description: listing.description,
    sourceUrls: listing.sourceUrls,
    publicContacts: filterKnownInvalidContacts(
      listing.publicContacts.map((contact) => contact.email || contact.linkedinUrl || contact.sourceUrl),
      listing.company || "",
      domainFromUrl(listing.companyUrl || listing.url),
    ),
    startupSignals,
    hiringSignals,
    founderNames: [],
    cities: uniqueNonEmpty([listing.location]),
    sizeBand: "",
    stageText: startupSignals.length ? "early-stage signal" : "",
    remotePolicy: listing.remoteScope || listing.workModel,
    openRoleCount: 1,
    startupScore: startupSignals.length ? 12 : 0,
    companyFitScore: 8,
    hiringSignalScore: hiringSignals.length * 4,
    contactabilityScore: listing.publicContacts.length ? 10 : 0,
    isStartupCandidate: startupSignals.length > 0,
    lastSeenAt: new Date().toISOString(),
  };
}

export function enrichListingWithCompanyPages(listing: ListingCandidate, page: PageRecord, contacts: ContactCandidate[]): ListingCandidate {
  const lowerHtml = page.html.toLowerCase();
  const update = { ...listing };
  if (!update.aboutUrl && /\/about/.test(lowerHtml)) update.aboutUrl = page.url;
  if (!update.teamUrl && /\/team/.test(lowerHtml)) update.teamUrl = page.url;
  if (!update.contactUrl && /\/contact/.test(lowerHtml)) update.contactUrl = page.url;
  if (!update.pressUrl && /\/press/.test(lowerHtml)) update.pressUrl = page.url;
  update.publicContacts = [...update.publicContacts, ...contacts];
  return update;
}
