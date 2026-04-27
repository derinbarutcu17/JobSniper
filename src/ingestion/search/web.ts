import * as cheerio from "cheerio";
import { summarizeToLine } from "../../lib/text.js";
import { normalizeUrl } from "../../lib/url.js";
import type { Dependencies, SearchProvider, SearchQuery, SearchResult } from "../../types.js";

function collectResults(
  html: string,
  query: SearchQuery,
  provider: string,
  selectors: { item: string; anchor: string; snippet: string },
): SearchResult[] {
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];

  $(selectors.item).each((_, element) => {
    const anchor = $(element).find(selectors.anchor).first();
    const title = anchor.text().trim();
    const url = normalizeUrl(anchor.attr("href") ?? "");
    const snippetNode = $(element).find(selectors.snippet).first();
    const snippetText =
      snippetNode.text().trim() ||
      anchor.parent().next().text().trim() ||
      $(element).text().replace(title, "").trim();
    const snippet = summarizeToLine(snippetText, 220);
    if (!title || !url) return;
    results.push({
      lane: query.lane,
      title,
      url,
      snippet,
      source: "search",
      query: query.query,
      provider,
    });
  });

  return results;
}

export class DuckDuckGoProvider implements SearchProvider {
  name = "duckduckgo";

  async search(query: SearchQuery, deps: Dependencies): Promise<SearchResult[]> {
    const response = await deps.fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query.query)}`);
    if (!response.ok) {
      throw new Error(`DuckDuckGo search failed with ${response.status}`);
    }
    const html = await response.text();
    return collectResults(html, query, this.name, {
      item: ".result",
      anchor: ".result__title a, .result__a",
      snippet: ".result__snippet",
    });
  }
}

export class BraveSearchProvider implements SearchProvider {
  name = "brave_html";

  async search(query: SearchQuery, deps: Dependencies): Promise<SearchResult[]> {
    const response = await deps.fetch(`https://search.brave.com/search?q=${encodeURIComponent(query.query)}&source=web`);
    if (!response.ok) {
      throw new Error(`Brave search failed with ${response.status}`);
    }
    const html = await response.text();
    return collectResults(html, query, this.name, {
      item: "div.snippet, div[data-type='web']",
      anchor: "a[href]",
      snippet: ".snippet-description, .description, p",
    });
  }
}

export function getSearchProviders(): SearchProvider[] {
  return [new DuckDuckGoProvider(), new BraveSearchProvider()];
}
