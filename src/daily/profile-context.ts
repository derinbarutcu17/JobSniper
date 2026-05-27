import fs from "node:fs";
import { resolveCachePath, resolveConfigPath } from "../lib/paths.js";
import type { Dependencies } from "../types.js";
import type { ProfileConfig, ProfileCacheSource, ProfileCacheStatus, ProfileContextCache } from "./daily-types.js";

const PROFILE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(value: string, limit = 1200): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}...`;
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function summarizeRepoFile(baseDir: string, name: string): ProfileCacheSource | null {
  const filePath = `${baseDir}/${name}`;
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, "utf8");
  return {
    label: name,
    url: filePath,
    summary: truncate(text.replace(/\s+/g, " ").trim(), 500),
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchText(url: string, deps: Dependencies): Promise<string> {
  const response = await deps.fetch(url, {
    headers: {
      accept: "text/html,application/json;q=0.9,*/*;q=0.8",
    },
  });
  if (!response.ok) {
    throw new Error(`Fetch failed for ${url} with ${response.status}`);
  }
  return await response.text();
}

async function fetchGithubSummary(profile: ProfileConfig, deps: Dependencies): Promise<ProfileCacheSource[]> {
  const profileMatch = profile.githubUrl.match(/github\.com\/([^/]+)/i);
  if (!profileMatch) return [];
  const username = profileMatch[1]!;
  const userResponse = await deps.fetch(`https://api.github.com/users/${username}`);
  if (!userResponse.ok) {
    throw new Error(`GitHub user lookup failed for ${username}`);
  }
  const userJson = await userResponse.json() as { bio?: string; public_repos?: number; followers?: number };
  const reposResponse = await deps.fetch(`https://api.github.com/users/${username}/repos?per_page=6&sort=updated`);
  if (!reposResponse.ok) {
    throw new Error(`GitHub repo lookup failed for ${username}`);
  }
  const reposJson = await reposResponse.json() as Array<{ name?: string; description?: string; language?: string }>;
  return [
    {
      label: "GitHub profile",
      url: profile.githubUrl,
      summary: truncate(`Bio: ${userJson.bio ?? ""}. Public repos: ${userJson.public_repos ?? 0}. Followers: ${userJson.followers ?? 0}.`),
      fetchedAt: new Date().toISOString(),
    },
    {
      label: "GitHub repositories",
      url: `${profile.githubUrl}?tab=repositories`,
      summary: truncate(
        reposJson
          .slice(0, 6)
          .map((repo) => `${repo.name ?? "repo"}: ${repo.description ?? "No description"}${repo.language ? ` [${repo.language}]` : ""}`)
          .join(" | "),
      ),
      fetchedAt: new Date().toISOString(),
    },
  ];
}

export function loadProfileConfig(baseDir: string): ProfileConfig {
  const profilePath = process.env.SNIPER_PROFILE_PATH || resolveConfigPath(baseDir, "profile.json");
  return readJsonFile(profilePath, {
    name: "",
    location: "",
    primaryPositioning: "",
    portfolioUrl: "",
    githubUrl: "",
    acceptedRoleFamilies: [],
    blockedRoleFamilies: [],
    projectSummaries: [],
    coreSkills: [],
  });
}

export async function loadProfileContext(
  baseDir: string,
  deps: Dependencies,
  refresh = false,
): Promise<{ profile: ProfileConfig; cache: ProfileContextCache; status: ProfileCacheStatus }> {
  const profile = loadProfileConfig(baseDir);
  const cachePath = resolveCachePath(baseDir, "profile-context.json");
  const existing = readJsonFile<ProfileContextCache>(cachePath, {
    generatedAt: "",
    expiresAt: "",
    sources: [],
    summary: "",
    warnings: [],
  });
  const now = deps.now().getTime();
  const cacheValid = Boolean(existing.generatedAt) && Boolean(existing.expiresAt) && new Date(existing.expiresAt).getTime() > now;
  const status: ProfileCacheStatus = {
    usedCache: cacheValid && !refresh,
    refreshed: false,
    staleFallback: false,
    cachePath,
    warnings: [],
  };

  if (cacheValid && !refresh) {
    return { profile, cache: existing, status };
  }

  if (!refresh) {
    const localSources = ["README.md", "AGENTS.md"]
      .map((name) => summarizeRepoFile(baseDir, name))
      .filter((entry): entry is ProfileCacheSource => Boolean(entry));
    const fallback: ProfileContextCache = {
      generatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + PROFILE_CACHE_TTL_MS).toISOString(),
      sources: localSources,
      summary: truncate(
        [
          profile.primaryPositioning,
          `Projects: ${profile.projectSummaries.join("; ")}`,
          `Skills: ${profile.coreSkills.join(", ")}`,
          ...localSources.map((source) => `${source.label}: ${source.summary}`),
        ].join(" "),
        4000,
      ),
      warnings: ["Using stable profile config and local repo context. Run --refresh-profile to refresh portfolio and GitHub cache."],
    };
    fs.writeFileSync(cachePath, `${JSON.stringify(fallback, null, 2)}\n`);
    status.refreshed = false;
    status.usedCache = false;
    status.warnings.push(...fallback.warnings);
    return { profile, cache: fallback, status };
  }

  try {
    const sources: ProfileCacheSource[] = [];
    if (profile.portfolioUrl) {
      const portfolioHtml = await fetchText(profile.portfolioUrl, deps);
      sources.push({
        label: "Portfolio homepage",
        url: profile.portfolioUrl,
        summary: truncate(stripHtml(portfolioHtml)),
        fetchedAt: new Date().toISOString(),
      });
    }
    if (profile.githubUrl) {
      sources.push(...await fetchGithubSummary(profile, deps));
    }
    for (const name of ["README.md", "AGENTS.md"]) {
      const summary = summarizeRepoFile(baseDir, name);
      if (summary) sources.push(summary);
    }

    const combinedSummary = truncate(
      [
        profile.primaryPositioning,
        `Projects: ${profile.projectSummaries.join("; ")}`,
        `Skills: ${profile.coreSkills.join(", ")}`,
        ...sources.map((source) => `${source.label}: ${source.summary}`),
      ].join(" "),
      4000,
    );
    const cache: ProfileContextCache = {
      generatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + PROFILE_CACHE_TTL_MS).toISOString(),
      sources,
      summary: combinedSummary,
      warnings: [],
    };
    fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
    status.refreshed = true;
    status.usedCache = false;
    return { profile, cache, status };
  } catch (error) {
    status.warnings.push(error instanceof Error ? error.message : String(error));
    if (existing.generatedAt) {
      status.staleFallback = true;
      return { profile, cache: existing, status };
    }
    const fallback: ProfileContextCache = {
      generatedAt: "",
      expiresAt: "",
      sources: [],
      summary: [profile.primaryPositioning, profile.projectSummaries.join("; "), profile.coreSkills.join(", ")].filter(Boolean).join(" "),
      warnings: status.warnings,
    };
    return { profile, cache: fallback, status };
  }
}
