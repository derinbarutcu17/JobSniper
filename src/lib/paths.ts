import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function getBaseDir(): string {
  if (process.env.SNIPER_BASE_DIR) {
    return process.env.SNIPER_BASE_DIR;
  }

  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function resolveDataPath(baseDir: string, ...parts: string[]): string {
  const dir = path.join(baseDir, "data");
  ensureDir(dir);
  return path.join(dir, ...parts);
}

export function resolveConfigPath(baseDir: string, ...parts: string[]): string {
  const dir = path.join(baseDir, "config");
  ensureDir(dir);
  return path.join(dir, ...parts);
}

export function resolveProfilePath(baseDir: string, ...parts: string[]): string {
  const dir = path.join(baseDir, "profile");
  ensureDir(dir);
  return path.join(dir, ...parts);
}

export function resolveMemoryPath(baseDir: string, ...parts: string[]): string {
  const dir = path.join(baseDir, "data", "memory");
  ensureDir(dir);
  return path.join(dir, ...parts);
}

export function resolveCachePath(baseDir: string, ...parts: string[]): string {
  const dir = path.join(baseDir, "data", "cache");
  ensureDir(dir);
  return path.join(dir, ...parts);
}

export function resolveImportPath(baseDir: string, ...parts: string[]): string {
  const dir = path.join(baseDir, "data", "import");
  ensureDir(dir);
  return path.join(dir, ...parts);
}

export function resolveReportPath(baseDir: string, ...parts: string[]): string {
  const dir = path.join(baseDir, "data", "reports");
  ensureDir(dir);
  return path.join(dir, ...parts);
}
