import { collectQueryTerms, getEnabledRolePackIds, isCompanyWatchLane } from "../../normalization/role-packs.js";
import type { LaneId, ProfileSummary, SearchQuery, SniperConfig } from "../../types.js";

const ATS_SITES = ["greenhouse.io", "jobs.lever.co", "ashbyhq.com", "workable.com", "teamtailor.com", "smartrecruiters.com", "recruitee.com", "personio.de", "wellfound.com"];

export function buildQueries(config: SniperConfig, profile: ProfileSummary): SearchQuery[] {
  if (config.search.maxQueriesPerLane <= 0) {
    return [];
  }
  const queries: SearchQuery[] = [];
  getEnabledRolePackIds(config).forEach((lane: LaneId) => {
    const laneTerms = collectQueryTerms(config, lane);
    const profileTerms = profile.toolSignals.slice(0, 4);
    const locationTerms = [...config.search.priorityCities.slice(0, 1)];
    const companyWatch = isCompanyWatchLane(config, lane);

    const baseFamilies: Array<SearchQuery["family"]> = companyWatch ? ["company", "contact"] : ["job", "company", "contact"];
    for (const family of baseFamilies) {
      for (const locale of ["tr", "en"] as const) {
        const configured = config.lanes[lane].queries[locale];
        for (const query of configured.slice(0, config.search.maxQueriesPerLane)) {
          queries.push({ lane, locale, query, family, providerHints: [] });
        }
      }
    }

    for (const role of laneTerms) {
      for (const location of locationTerms) {
        queries.push({
          lane,
          locale: "en",
          query: `${role} ${location}`,
          family: companyWatch ? "company" : "job",
          providerHints: [],
        });
        queries.push({
          lane,
          locale: "en",
          query: `${role} remote ${profileTerms.join(" ")}`.trim(),
          family: companyWatch ? "company" : "job",
          providerHints: ["remote"],
        });
      }
      for (const site of ATS_SITES) {
        queries.push({
          lane,
          locale: "en",
          query: `${role} site:${site}`,
          family: "job",
          providerHints: [site],
        });
      }
    }

    for (const term of profileTerms) {
      queries.push({
        lane,
        locale: "en",
        query: `${term} careers startup`,
        family: companyWatch ? "company" : "contact",
        providerHints: ["startup"],
      });
    }
  });

  return queries;
}
