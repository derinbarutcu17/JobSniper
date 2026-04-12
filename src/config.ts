import fs from "node:fs";
import path from "node:path";
import { SniperError } from "./errors.js";
import { ensureDir } from "./lib/paths.js";
import { builtInRolePacks } from "./role-packs.js";
import type { LaneConfig, LaneId, SniperConfig } from "./types.js";

type ConfigOverrides = Omit<Partial<SniperConfig>, "lanes"> & {
  lanes?: Record<LaneId, Partial<LaneConfig>>;
};

export const defaultConfig: SniperConfig = {
  search: {
    maxResultsPerQuery: 8,
    maxQueriesPerLane: 8,
    minScoreThreshold: 45,
    browserFallback: false,
    searchProviderConcurrency: 4,
    pageFetchConcurrency: 6,
    maxPagesPerDomainPerRun: 10,
    retries: 2,
    timeoutMs: 10000,
    priorityCities: ["Berlin"],
    priorityCountries: ["Germany", "Deutschland"],
    remoteScopes: ["remote", "hybrid"],
  },
  lanes: builtInRolePacks,
  sources: {
    rss: [
      { name: "Berlin Startup Jobs Design", url: "https://berlinstartupjobs.com/design/feed/" },
      { name: "Berlin Startup Jobs Engineering", url: "https://berlinstartupjobs.com/engineering/feed/" },
    ],
    atsBoards: [
      { name: "Wellfound Berlin Startups", provider: "wellfound", url: "https://wellfound.com/startups/location/berlin-berlin", lane: "company_watch" },
      { name: "Wellfound Berlin Design Jobs", provider: "wellfound", url: "https://wellfound.com/location/berlin-berlin", lane: "design_jobs" },
      { name: "Wellfound Berlin AI / Engineering Jobs", provider: "wellfound", url: "https://wellfound.com/location/berlin-berlin", lane: "ai_coding_jobs" },
    ],
  },
  blacklist: {
    companies: [],
    keywords: ["account executive", "sales", "gtm", "performance marketing", "chief of staff", "cto", "cfo"],
    titleTerms: ["senior", "lead", "manager", "director", "head", "vp", "principal", "staff", "founder", "co-founder", "cofounder"],
    softPenaltyTerms: ["stakeholder management", "people management", "budget ownership", "consulting"],
    lanes: Object.fromEntries(Object.keys(builtInRolePacks).map((lane) => [lane, []])),
  },
  sheets: {
    spreadsheetId: "",
    createIfMissing: true,
    folderId: "",
    tabs: {
      jobs: "Jobs",
      companies: "Companies",
      contacts: "Contacts",
      runMetrics: "RunMetrics",
      dailyJobsPrefix: "Jobs ",
    },
  },
};

function mergeLane(base: LaneConfig | undefined, override?: Partial<LaneConfig>): LaneConfig {
  return {
    label: override?.label ?? base?.label ?? "Custom Lane",
    type: override?.type ?? base?.type ?? "job",
    enabled: override?.enabled ?? base?.enabled ?? true,
    queries: {
      tr: override?.queries?.tr ?? base?.queries.tr ?? [],
      en: override?.queries?.en ?? base?.queries.en ?? [],
    },
    keywords: override?.keywords ?? base?.keywords ?? [],
    queryTerms: override?.queryTerms ?? base?.queryTerms ?? base?.keywords ?? [],
    profileSignals: override?.profileSignals ?? base?.profileSignals ?? base?.keywords ?? [],
    titleFamilies: override?.titleFamilies ?? base?.titleFamilies ?? [],
    mismatchTerms: override?.mismatchTerms ?? base?.mismatchTerms ?? [],
    startupTerms: override?.startupTerms ?? base?.startupTerms ?? [],
    companyTerms: override?.companyTerms ?? base?.companyTerms ?? [],
  };
}

function mergeLanes(
  base: Record<LaneId, LaneConfig>,
  overrides?: Record<LaneId, Partial<LaneConfig>>,
): Record<LaneId, LaneConfig> {
  const allLaneIds = new Set<LaneId>([...Object.keys(base), ...Object.keys(overrides ?? {})]);
  const lanes: Record<LaneId, LaneConfig> = {};
  for (const lane of allLaneIds) {
    lanes[lane] = mergeLane(base[lane], overrides?.[lane]);
  }
  return lanes;
}

function mergeLaneBlacklists(base: Record<LaneId, string[]>, overrides?: Record<LaneId, string[]>): Record<LaneId, string[]> {
  const allLaneIds = new Set<LaneId>([...Object.keys(base), ...Object.keys(overrides ?? {})]);
  const lanes: Record<LaneId, string[]> = {};
  for (const lane of allLaneIds) {
    lanes[lane] = overrides?.[lane] ?? base[lane] ?? [];
  }
  return lanes;
}

function mergeConfig(base: SniperConfig, overrides: ConfigOverrides): SniperConfig {
  return {
    ...base,
    ...overrides,
    search: { ...base.search, ...(overrides.search ?? {}) },
    lanes: mergeLanes(base.lanes, overrides.lanes),
    sources: {
      rss: overrides.sources?.rss ?? base.sources.rss,
      atsBoards: overrides.sources?.atsBoards ?? base.sources.atsBoards,
    },
    blacklist: {
      companies: overrides.blacklist?.companies ?? base.blacklist.companies,
      keywords: overrides.blacklist?.keywords ?? base.blacklist.keywords,
      titleTerms: overrides.blacklist?.titleTerms ?? base.blacklist.titleTerms,
      softPenaltyTerms: overrides.blacklist?.softPenaltyTerms ?? base.blacklist.softPenaltyTerms,
      lanes: mergeLaneBlacklists(base.blacklist.lanes, overrides.blacklist?.lanes),
    },
    sheets: {
      ...base.sheets,
      ...(overrides.sheets ?? {}),
      tabs: { ...base.sheets.tabs, ...(overrides.sheets?.tabs ?? {}) },
    },
  };
}

function sanitizeConfig(config: SniperConfig): SniperConfig {
  const validLaneIds = new Set(Object.keys(config.lanes));
  const sanitizedLaneBlacklists = Object.fromEntries(
    Object.entries(config.blacklist.lanes).filter(([lane]) => validLaneIds.has(lane)),
  );

  const sanitizedLanes = Object.fromEntries(
    Object.entries(config.lanes).map(([laneId, lane]) => [
      laneId,
      {
        ...lane,
        type: lane.type === "company_watch" ? "company_watch" : "job",
        queries: {
          tr: lane.queries?.tr ?? [],
          en: lane.queries?.en ?? [],
        },
      },
    ]),
  ) as SniperConfig["lanes"];

  return {
    ...config,
    lanes: sanitizedLanes,
    blacklist: {
      ...config.blacklist,
      lanes: sanitizedLaneBlacklists,
    },
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function validateLaneConfig(laneId: string, lane: LaneConfig): void {
  if (lane.type !== "job" && lane.type !== "company_watch") {
    throw new SniperError(`Lane "${laneId}" has invalid type "${String(lane.type)}".`, "config_error");
  }
  if (typeof lane.enabled !== "boolean") {
    throw new SniperError(`Lane "${laneId}" must set enabled to true or false.`, "config_error");
  }
  if (!isStringArray(lane.queries.en) || !isStringArray(lane.queries.tr)) {
    throw new SniperError(`Lane "${laneId}" must define query arrays for en and tr.`, "config_error");
  }
  if (!isStringArray(lane.keywords)) {
    throw new SniperError(`Lane "${laneId}" keywords must be a string array.`, "config_error");
  }
  if (!isStringArray(lane.queryTerms)) {
    throw new SniperError(`Lane "${laneId}" queryTerms must be a string array.`, "config_error");
  }
  if (!isStringArray(lane.profileSignals)) {
    throw new SniperError(`Lane "${laneId}" profileSignals must be a string array.`, "config_error");
  }
  if (!isStringArray(lane.mismatchTerms) || !isStringArray(lane.startupTerms) || !isStringArray(lane.companyTerms)) {
    throw new SniperError(`Lane "${laneId}" contains malformed term lists.`, "config_error");
  }
  if (!Array.isArray(lane.titleFamilies)) {
    throw new SniperError(`Lane "${laneId}" titleFamilies must be an array.`, "config_error");
  }
  if (
    !lane.titleFamilies.every(
      (entry) =>
        entry &&
        typeof entry.family === "string" &&
        isStringArray(entry.terms),
    )
  ) {
    throw new SniperError(`Lane "${laneId}" has an invalid title family definition.`, "config_error");
  }
  const hasQueries = lane.queries.en.length > 0 || lane.queries.tr.length > 0;
  const hasTerms = lane.keywords.length > 0 || lane.queryTerms.length > 0;
  if (lane.enabled && !hasQueries && !hasTerms) {
    throw new SniperError(`Lane "${laneId}" is enabled but has no queries or keywords.`, "config_error");
  }
}

function validateConfig(config: SniperConfig): SniperConfig {
  if (Object.keys(config.lanes).length === 0) {
    throw new SniperError("Config must define at least one lane.", "config_error");
  }

  for (const [laneId, lane] of Object.entries(config.lanes)) {
    validateLaneConfig(laneId, lane);
  }

  if (!isStringArray(config.blacklist.companies) || !isStringArray(config.blacklist.keywords) || !isStringArray(config.blacklist.titleTerms) || !isStringArray(config.blacklist.softPenaltyTerms)) {
    throw new SniperError("Blacklist fields must all be string arrays.", "config_error");
  }

  for (const [laneId, terms] of Object.entries(config.blacklist.lanes)) {
    if (!(laneId in config.lanes)) {
      throw new SniperError(`Blacklist lane "${laneId}" does not exist in config.lanes.`, "config_error");
    }
    if (!isStringArray(terms)) {
      throw new SniperError(`Blacklist lane "${laneId}" must be a string array.`, "config_error");
    }
  }

  if (!config.sheets.tabs.jobs || !config.sheets.tabs.companies || !config.sheets.tabs.contacts || !config.sheets.tabs.runMetrics) {
    throw new SniperError("Sheets tabs must define jobs, companies, contacts, and runMetrics titles.", "config_error");
  }

  for (const board of config.sources.atsBoards) {
    if (!board.lane || typeof board.lane !== "string") {
      throw new SniperError(`ATS source "${board.name}" must define a lane.`, "config_error");
    }
    if (!(board.lane in config.lanes)) {
      throw new SniperError(`ATS source "${board.name}" references unknown lane "${board.lane}".`, "config_error");
    }
  }

  return config;
}

function migrateLegacyConfig(raw: Record<string, unknown>): ConfigOverrides {
  const search = (raw.search ?? {}) as Record<string, unknown>;
  const legacySources = Array.isArray(raw.sources) ? (raw.sources as Array<Record<string, unknown>>) : [];
  const blacklist = (raw.blacklist ?? {}) as Record<string, unknown>;
  const includeKeywords = Array.isArray(search.include_keywords)
    ? search.include_keywords.filter((entry): entry is string => typeof entry === "string")
    : [];
  const excludeKeywords = Array.isArray(search.exclude_keywords)
    ? search.exclude_keywords.filter((entry): entry is string => typeof entry === "string")
    : [];

  const lanes = Object.fromEntries(
    Object.keys(defaultConfig.lanes).map((lane) => [
      lane,
      { keywords: includeKeywords } as Partial<LaneConfig>,
    ]),
  ) as Record<LaneId, Partial<LaneConfig>>;

  return {
    search: {
      minScoreThreshold:
        typeof search.min_match_threshold === "number"
          ? search.min_match_threshold
          : defaultConfig.search.minScoreThreshold,
    } as Partial<SniperConfig["search"]> as SniperConfig["search"],
    lanes,
    sources: {
      rss: legacySources
        .filter((entry) => entry.type === "rss" && typeof entry.url === "string")
        .map((entry) => ({ name: String(entry.name ?? entry.url), url: String(entry.url) })),
      atsBoards: defaultConfig.sources.atsBoards,
    },
    blacklist: {
      companies: Array.isArray(blacklist.companies)
        ? blacklist.companies.filter((entry): entry is string => typeof entry === "string")
        : [],
      keywords: excludeKeywords.length ? excludeKeywords : defaultConfig.blacklist.keywords,
      titleTerms: defaultConfig.blacklist.titleTerms,
      softPenaltyTerms: defaultConfig.blacklist.softPenaltyTerms,
      lanes: defaultConfig.blacklist.lanes,
    },
  };
}

function normalizeModernConfig(parsed: Record<string, unknown>): ConfigOverrides {
  const partial = parsed as ConfigOverrides;
  if (!partial.lanes) {
    return partial;
  }
  return {
    ...partial,
    lanes: Object.fromEntries(
      Object.entries(partial.lanes).map(([lane, value]) => [lane, value]),
    ) as Record<LaneId, Partial<LaneConfig>>,
    blacklist: partial.blacklist
      ? {
          ...partial.blacklist,
          lanes: partial.blacklist.lanes ?? {},
        }
      : undefined,
  };
}

export function loadConfig(baseDir: string): SniperConfig {
  const configPath = path.join(baseDir, "config.json");
  if (!fs.existsSync(configPath)) {
    return validateConfig(defaultConfig);
  }

  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
  const looksModern =
    (typeof parsed.lanes === "object" && parsed.lanes !== null) ||
    (typeof parsed.sources === "object" && parsed.sources !== null) ||
    (typeof parsed.sheets === "object" && parsed.sheets !== null) ||
    (typeof parsed.blacklist === "object" && parsed.blacklist !== null);

  return validateConfig(
    sanitizeConfig(
      looksModern
        ? mergeConfig(defaultConfig, normalizeModernConfig(parsed))
        : mergeConfig(defaultConfig, migrateLegacyConfig(parsed)),
    ),
  );
}

export function saveConfig(baseDir: string, config: SniperConfig): void {
  ensureDir(baseDir);
  fs.writeFileSync(path.join(baseDir, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
}
