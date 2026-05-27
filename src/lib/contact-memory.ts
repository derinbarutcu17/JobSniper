import fs from "node:fs";
import path from "node:path";

type InvalidContactEntry = {
  company?: string;
  domain?: string;
  value: string;
  kind?: string;
  state?: string;
};

type SourceState = {
  knownInvalidContacts?: InvalidContactEntry[];
};

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value);
}

function loadSourceState(baseDir = process.cwd()): SourceState {
  const filePath = path.join(baseDir, "data", "memory", "source-state.json");
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as SourceState;
  } catch {
    return {};
  }
}

function matchesCompany(entry: InvalidContactEntry, companyName: string, companyDomain: string): boolean {
  const normalizedCompany = normalizeText(companyName);
  const normalizedDomain = normalizeText(companyDomain);
  const entryCompany = normalizeText(entry.company ?? "");
  const entryDomain = normalizeText(entry.domain ?? "");
  return Boolean(
    (entryCompany && entryCompany === normalizedCompany) ||
      (entryDomain && entryDomain === normalizedDomain) ||
      (entryCompany && normalizedDomain && normalizedDomain.includes(entryCompany)) ||
      (entryDomain && normalizedCompany && normalizedCompany.includes(entryDomain)),
  );
}

export function filterKnownInvalidContacts(
  contacts: string[],
  companyName: string,
  companyDomain = "",
  baseDir = process.cwd(),
): string[] {
  const state = loadSourceState(baseDir);
  const invalidEntries = state.knownInvalidContacts ?? [];
  if (!invalidEntries.length) return contacts;

  return contacts.filter((value) => {
    const normalizedValue = normalizeText(value);
    return !invalidEntries.some((entry) => {
      if (!entry.value) return false;
      if (!matchesCompany(entry, companyName, companyDomain)) return false;
      if (normalizeText(entry.value) === normalizedValue) return true;
      if ((entry.kind ?? "").toLowerCase() === "email" && isEmail(value) && normalizeText(entry.value) === normalizedValue) {
        return true;
      }
      return false;
    });
  });
}
