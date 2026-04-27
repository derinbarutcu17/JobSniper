import type { LaneConfig, LaneId, RolePackTitleFamily, SniperConfig } from "./types.js";
import { normalizeText } from "./lib/text.js";

const DEFAULT_TITLE_FAMILIES: RolePackTitleFamily[] = [
  { family: "Product Designer", terms: ["product designer", "ürün tasarımcısı", "product design"] },
  { family: "UI/UX Designer", terms: ["ui/ux designer", "ux/ui designer", "ux designer", "ui designer", "visual designer"] },
  { family: "Design Engineer", terms: ["design engineer", "creative technologist", "design technologist", "design systems engineer"] },
  { family: "Frontend Engineer", terms: ["frontend engineer", "front-end engineer", "react developer"] },
  { family: "AI Engineer", terms: ["ai engineer", "ml engineer", "llm engineer"] },
  { family: "Automation Engineer", terms: ["automation engineer", "agent engineer", "agent workflow builder"] },
  { family: "GenAI Product Builder", terms: ["genai", "agent workflows", "ai product", "ai product engineer"] },
];

export const builtInRolePacks: Record<LaneId, LaneConfig> = {
  design_jobs: {
    label: "Design Jobs",
    type: "job",
    enabled: true,
    queries: {
      tr: [],
      en: [
        "Berlin product designer jobs",
        "Germany UX UI designer careers",
        "Berlin design engineer figma react jobs",
      ],
    },
    keywords: ["product designer", "ux", "ui", "figma", "design systems", "creative technologist", "design engineer"],
    queryTerms: ["product designer", "ux designer", "ui designer", "design engineer", "creative technologist"],
    profileSignals: ["figma", "product design", "ux", "ui", "design systems", "visual design", "brand", "motion", "creative", "design engineer", "creative technologist"],
    titleFamilies: DEFAULT_TITLE_FAMILIES,
    mismatchTerms: ["customer success", "sales manager", "growth partner", "account executive", "business development", "legal", "commission-only", "devops", "kubernetes", "golang", "backend"],
    startupTerms: ["seed", "series a", "founding", "small team", "0-1"],
    companyTerms: ["startup", "studio", "builder"],
  },
  ai_coding_jobs: {
    label: "AI Coding Jobs",
    type: "job",
    enabled: true,
    queries: {
      tr: [],
      en: [
        "Berlin AI engineer jobs",
        "Germany LLM engineer jobs",
        "Berlin agent engineer TypeScript Python startup",
      ],
    },
    keywords: ["ai engineer", "llm", "agent", "automation", "typescript", "node", "python", "developer tools", "creative automation"],
    queryTerms: ["ai engineer", "llm engineer", "agent engineer", "automation engineer", "genai product builder"],
    profileSignals: ["ai", "llm", "agent", "automation", "typescript", "node", "python", "developer tools", "full-stack", "openai", "react"],
    titleFamilies: DEFAULT_TITLE_FAMILIES,
    mismatchTerms: ["customer success", "sales manager", "growth partner", "account executive", "business development", "legal", "commission-only", "machine learning intern"],
    startupTerms: ["seed", "series a", "founding", "small team", "0-1"],
    companyTerms: ["startup", "builder", "developer tools"],
  },
  student_jobs: {
    label: "Student & Working Student Jobs",
    type: "job",
    enabled: true,
    queries: {
      tr: [],
      en: [
        "Berlin werkstudent jobs",
        "Berlin working student jobs",
        "Berlin internship jobs",
        "Berlin praktikum jobs",
        "Berlin student assistant jobs",
        "Berlin part-time student jobs",
      ],
    },
    keywords: [
      "werkstudent",
      "working student",
      "student assistant",
      "intern",
      "internship",
      "praktikum",
      "part-time student",
      "junior",
      "entry-level",
      "trainee",
    ],
    queryTerms: [
      "werkstudent",
      "working student",
      "student assistant",
      "internship",
      "praktikum",
      "student jobs",
      "werkstudent product design",
      "working student frontend",
      "working student ai",
      "student assistant product",
      "intern product design",
      "intern software engineer",
    ],
    profileSignals: [
      "werkstudent",
      "working student",
      "student assistant",
      "internship",
      "figma",
      "product design",
      "ux",
      "react",
      "typescript",
      "ai",
      "automation",
    ],
    titleFamilies: [
      ...DEFAULT_TITLE_FAMILIES,
      { family: "Working Student", terms: ["werkstudent", "working student", "student assistant", "part-time student"] },
      { family: "Intern", terms: ["intern", "internship", "praktikum", "trainee"] },
    ],
    mismatchTerms: [
      "customer success",
      "sales manager",
      "growth partner",
      "account executive",
      "business development",
      "commission-only",
      "door to door",
      "call center",
      "full-time only",
      "senior",
    ],
    startupTerms: ["seed", "series a", "founding", "small team", "0-1"],
    companyTerms: ["startup", "studio", "builder", "career", "hiring", "team"],
  },
  company_watch: {
    label: "Company Watch",
    type: "company_watch",
    enabled: true,
    queries: {
      tr: [],
      en: [
        "site:directory.startupberlin.co Berlin startups",
        "site:ai.berlin/ecosystem/directory Berlin startups",
        "site:berlin.startups-list.com Berlin startups",
        "site:startup-ecosystem.org/berlin Berlin startups",
        "site:handpickedberlin.com Berlin funded startups",
        "site:seedtable.com/startups-berlin Berlin startups",
        "site:startupberlin.co Berlin startups",
      ],
    },
    keywords: ["careers", "jobs", "hiring", "team", "startup", "founding", "series a", "seed", "Berlin"],
    queryTerms: ["Berlin startup", "Berlin company", "Berlin founders"],
    profileSignals: ["careers", "hiring", "team", "startup", "founding", "Berlin"],
    titleFamilies: DEFAULT_TITLE_FAMILIES,
    mismatchTerms: [],
    startupTerms: ["seed", "series a", "founding", "small team", "0-1"],
    companyTerms: ["startup", "studio", "builder", "careers", "hiring", "team", "Berlin"],
  },
};

export function getRolePack(config: SniperConfig, lane: LaneId): LaneConfig | undefined {
  return config.lanes[lane];
}

export function getRolePackIds(config: SniperConfig): LaneId[] {
  return Object.keys(config.lanes);
}

export function getEnabledRolePackIds(config: SniperConfig): LaneId[] {
  return getRolePackIds(config).filter((lane) => config.lanes[lane]?.enabled);
}

export function isCompanyWatchLane(config: SniperConfig, lane: LaneId): boolean {
  return getRolePack(config, lane)?.type === "company_watch";
}

export function getDefaultCompanyWatchLane(config: SniperConfig): LaneId {
  return getEnabledRolePackIds(config).find((lane) => isCompanyWatchLane(config, lane)) ?? "company_watch";
}

export function getDefaultJobLane(config: SniperConfig): LaneId {
  return getEnabledRolePackIds(config).find((lane) => !isCompanyWatchLane(config, lane)) ?? getRolePackIds(config)[0] ?? "general_jobs";
}

export function collectProfileSignals(config: SniperConfig): string[] {
  return [...new Set(
    getRolePackIds(config).flatMap((lane) => config.lanes[lane]?.profileSignals ?? config.lanes[lane]?.keywords ?? []),
  )];
}

export function collectQueryTerms(config: SniperConfig, lane: LaneId): string[] {
  const pack = getRolePack(config, lane);
  if (!pack) return [];
  return [...new Set([...(pack.queryTerms ?? []), ...pack.keywords])];
}

export function collectMismatchTerms(config: SniperConfig, lane: LaneId): string[] {
  return getRolePack(config, lane)?.mismatchTerms ?? [];
}

export function collectStartupTerms(config: SniperConfig, lane: LaneId): string[] {
  return getRolePack(config, lane)?.startupTerms ?? ["seed", "series a", "founding", "small team", "0-1"];
}

export function normalizeTitleFamilyWithConfig(config: SniperConfig, lane: LaneId, text: string): string {
  const normalized = normalizeText(text);
  const families = getRolePack(config, lane)?.titleFamilies ?? DEFAULT_TITLE_FAMILIES;
  return families.find((entry) => entry.terms.some((term) => normalized.includes(normalizeText(term))))?.family ?? "Other";
}

export function inferRolePackLane(
  config: SniperConfig,
  text: string,
  preferredType?: "job" | "company_watch",
): LaneId {
  const normalized = normalizeText(text);
  let bestLane = preferredType === "company_watch" ? getDefaultCompanyWatchLane(config) : getDefaultJobLane(config);
  let bestScore = -1;

  for (const lane of getEnabledRolePackIds(config)) {
    const pack = config.lanes[lane];
    if (!pack) continue;
    if (preferredType && pack.type !== preferredType) continue;
    const signals = [
      ...pack.keywords,
      ...(pack.queryTerms ?? []),
      ...(pack.profileSignals ?? []),
      ...(pack.companyTerms ?? []),
    ];
    const score = signals.reduce((total, signal) => total + (normalized.includes(normalizeText(signal)) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestLane = lane;
    }
  }

  return bestLane;
}
