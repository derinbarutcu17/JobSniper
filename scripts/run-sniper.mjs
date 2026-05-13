import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const baseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliEntry = path.join(baseDir, "scripts", "run-sniper-cli.mjs");

const result = spawnSync(process.execPath, ["--import", "tsx", cliEntry, ...process.argv.slice(2)], {
  cwd: baseDir,
  stdio: "inherit",
  env: { ...process.env, SNIPER_BASE_DIR: baseDir },
});

process.exit(result.status ?? 1);
