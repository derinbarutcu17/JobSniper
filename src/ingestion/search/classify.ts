import { normalizeText } from "../../lib/text.js";
import type { DiscoveryCandidate, PageIntent, PageType } from "../../types.js";

function inferIntent(url: string, text: string): PageIntent {
  const combined = normalizeText(`${url} ${text}`);
  if (/(careers|jobs|job|role|apply|hiring)/.test(combined)) return "job";
  if (/(team|contact|about|press|imprint)/.test(combined)) return "contact";
  if (/(startup|company|studio|product)/.test(combined)) return "company";
  return "unknown";
}

export function classifyCandidate(candidate: DiscoveryCandidate): DiscoveryCandidate {
  const combined = `${candidate.url} ${candidate.title} ${candidate.snippet}`;
  const intent = inferIntent(candidate.url, combined);
  return {
    ...candidate,
    intent,
    sourceType:
      intent === "job" && /(careers|jobs|job|apply)/i.test(candidate.url)
        ? "career_page"
        : candidate.sourceType,
    confidence:
      intent === "job" ? 0.9 : intent === "company" ? 0.75 : intent === "contact" ? 0.7 : candidate.confidence,
  };
}

export function classifyPageType(url: string, text: string): PageType {
  const combined = normalizeText(`${url} ${text}`);
  if (/(contact|imprint|press)/.test(combined)) return "contact_page";
  if (/(team|leadership|founders)/.test(combined)) return "team_page";
  if (/(about|story)/.test(combined)) return "about_page";
  if (/(apply now|jobposting|employment type|valid through|\/jobs?\/[^/\s]+|\/role\/[^/\s]+)/.test(combined)) return "job_detail";
  if (/(careers|jobs|open roles|join us)/.test(combined)) return "career_hub";
  return "generic";
}
