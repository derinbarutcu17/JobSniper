import { isCompanyWatchLane } from "./role-packs.js";
import type { LaneId, QueryPack, SniperConfig } from "../types.js";

const DEFAULT_JOB_POSITIVE_TERMS = [
  "design engineer",
  "creative technologist",
  "product designer",
  "ux engineer",
  "ui engineer",
  "design technologist",
  "frontend designer",
  "product design",
  "interaction designer",
  "ai product",
  "ai designer",
];

const DEFAULT_JOB_NEGATIVE_TERMS = [
  "senior",
  "lead",
  "manager",
  "director",
  "head",
  "vp",
  "principal",
  "staff",
  "cto",
  "cfo",
  "account executive",
  "sales manager",
  "business development",
  "devops",
  "backend",
  "data scientist",
  "ml engineer",
];

const DEFAULT_COMPANY_POSITIVE_TERMS = [
  "startup",
  "seed",
  "series a",
  "founding",
  "small team",
  "0-1",
  "early stage",
  "hiring",
  "careers",
  "join us",
];

const DEFAULT_COMPANY_NEGATIVE_TERMS = [
  "enterprise",
  "consulting",
  "agency",
  " outsourcing",
  "staff augmentation",
];

const DEFAULT_EXCLUDED_DOMAINS = [
  "linkedin.com",
  "glassdoor.com",
  "indeed.com",
  "stepstone.de",
  "xing.com",
  "monster.de",
  "ziprecruiter.com",
];

function buildJobQueryPack(config: SniperConfig, lane: LaneId): QueryPack {
  const laneConfig = config.lanes[lane];
  const positiveTerms = laneConfig?.queryTerms?.length
    ? laneConfig.queryTerms
    : DEFAULT_JOB_POSITIVE_TERMS;
  const negativeTerms = [...DEFAULT_JOB_NEGATIVE_TERMS, ...(config.blacklist.keywords ?? [])];

  return {
    id: `job_${lane}`,
    label: `${laneConfig?.label ?? lane} — Job Applications`,
    target: "job",
    positiveTerms,
    negativeTerms,
    locationFilters: [...config.search.priorityCities, ...config.search.priorityCountries],
    sourceCaps: {
      maxPerSource: config.search.maxResultsPerQuery,
      excludedDomains: DEFAULT_EXCLUDED_DOMAINS,
    },
    lane,
  };
}

function buildCompanyQueryPack(config: SniperConfig, lane: LaneId): QueryPack {
  const laneConfig = config.lanes[lane];
  const positiveTerms = laneConfig?.companyTerms?.length
    ? laneConfig.companyTerms
    : DEFAULT_COMPANY_POSITIVE_TERMS;
  const negativeTerms = [...DEFAULT_COMPANY_NEGATIVE_TERMS, ...(config.blacklist.keywords ?? [])];

  return {
    id: `company_${lane}`,
    label: `${laneConfig?.label ?? lane} — Company Outreach`,
    target: "company",
    positiveTerms,
    negativeTerms,
    locationFilters: [...config.search.priorityCities, ...config.search.priorityCountries],
    sourceCaps: {
      maxPerSource: config.search.maxResultsPerQuery,
      excludedDomains: DEFAULT_EXCLUDED_DOMAINS,
    },
    lane,
  };
}

export function buildQueryPacks(config: SniperConfig): QueryPack[] {
  const packs: QueryPack[] = [];
  for (const lane of Object.keys(config.lanes)) {
    if (!config.lanes[lane]?.enabled) continue;
    if (isCompanyWatchLane(config, lane)) {
      packs.push(buildCompanyQueryPack(config, lane));
    } else {
      packs.push(buildJobQueryPack(config, lane));
      packs.push(buildCompanyQueryPack(config, lane));
    }
  }
  return packs;
}

export function matchesQueryPack(pack: QueryPack, text: string): { match: boolean; reason?: string } {
  const normalized = text.toLowerCase();
  for (const term of pack.negativeTerms) {
    if (normalized.includes(term.toLowerCase())) {
      return { match: false, reason: `negative term: ${term}` };
    }
  }
  for (const term of pack.positiveTerms) {
    if (normalized.includes(term.toLowerCase())) {
      return { match: true };
    }
  }
  return { match: false, reason: "no positive term match" };
}

export function isAllowedDomain(pack: QueryPack, url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (pack.sourceCaps.excludedDomains?.some((d) => hostname.includes(d.toLowerCase()))) {
      return false;
    }
    if (pack.sourceCaps.allowedDomains?.length) {
      return pack.sourceCaps.allowedDomains.some((d) => hostname.includes(d.toLowerCase()));
    }
    return true;
  } catch {
    return false;
  }
}
