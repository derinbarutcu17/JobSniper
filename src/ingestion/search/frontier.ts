import { mapLimit, withTimeout } from "../../lib/async.js";
import { domainFromUrl, domainTitleFingerprint, normalizeUrl, sourceFingerprint } from "../../lib/url.js";
import type { Dependencies, DiscoveryCandidate, SearchProvider, SearchQuery, SearchResult, SniperConfig } from "../../types.js";

export function dedupeSearchResults(results: SearchResult[]): {
  candidates: DiscoveryCandidate[];
  deduped: number;
} {
  const seenUrls = new Set<string>();
  const seenTitleDomain = new Set<string>();
  const seenSource = new Set<string>();
  const candidates: DiscoveryCandidate[] = [];

  for (const result of results) {
    const normalizedUrl = normalizeUrl(result.url);
    const domain = domainFromUrl(normalizedUrl);
    const titleDomain = domainTitleFingerprint(domain, result.title);
    const sourceKey = sourceFingerprint(normalizedUrl, result.title, result.snippet);
    if (seenUrls.has(normalizedUrl) || seenTitleDomain.has(titleDomain) || seenSource.has(sourceKey)) {
      continue;
    }
    seenUrls.add(normalizedUrl);
    seenTitleDomain.add(titleDomain);
    seenSource.add(sourceKey);
    candidates.push({
      url: result.url,
      normalizedUrl,
      sourceType: "search",
      lane: result.lane,
      intent: "unknown",
      query: result.query,
      confidence: 0.6,
      source: result.provider,
      discoveredAt: new Date().toISOString(),
      domain,
      title: result.title,
      snippet: result.snippet,
    });
  }

  return { candidates, deduped: results.length - candidates.length };
}

export async function gatherSearchCandidates(
  queries: SearchQuery[],
  providers: SearchProvider[],
  deps: Dependencies,
  config: SniperConfig,
): Promise<{ candidates: DiscoveryCandidate[]; deduped: number; sourceBreakdown: Record<string, number> }> {
  const results = await mapLimit(
    queries,
    config.search.searchProviderConcurrency,
    async (query) => {
      const settled = await Promise.allSettled(
        providers.map((provider) => withTimeout(provider.search(query, deps), config.search.timeoutMs, `search:${provider.name}`)),
      );
      return settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
    },
  );
  const flattened = results.flat() as SearchResult[];
  const { candidates, deduped } = dedupeSearchResults(flattened);
  const sourceBreakdown = flattened.reduce<Record<string, number>>((acc, result) => {
    acc[result.provider] = (acc[result.provider] ?? 0) + 1;
    return acc;
  }, {});
  return { candidates, deduped, sourceBreakdown };
}
