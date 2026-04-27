import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const baseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsxBin = path.join(baseDir, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
const cliEntry = path.join(baseDir, "scripts", "run-sniper-cli.mjs");

const result = spawnSync(tsxBin, [cliEntry, ...process.argv.slice(2)], {
  cwd: baseDir,
  stdio: "inherit",
  env: { ...process.env, SNIPER_BASE_DIR: baseDir },
});

process.exit(result.status ?? 1);
