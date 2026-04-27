import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const baseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const liveDir = path.resolve(baseDir, "..", "jobsniper-live");

function run(command, args, cwd = baseDir, opts = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
    ...opts,
  });
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function ensureLinkedLiveDir() {
  if (!fs.existsSync(liveDir)) {
    throw new Error(`Live dashboard directory not found: ${liveDir}`);
  }
  if (!fs.existsSync(path.join(liveDir, "index.html"))) {
    throw new Error(`Live dashboard directory is missing index.html: ${liveDir}`);
  }
}

function syncDashboardFiles() {
  run("rsync", ["-a", "--delete", `${path.join(baseDir, "dashboard")}/`, `${liveDir}/`], baseDir);
}

function deployIfRequested() {
  if (!process.argv.includes("--deploy")) return;
  if (!fs.existsSync(path.join(liveDir, ".vercel", "project.json"))) {
    throw new Error("Live dashboard is not linked to a Vercel project. Run a manual Vercel deploy once from jobsniper-live first.");
  }
  run("npx", ["vercel", "deploy", "--prod", "--yes"], liveDir);
}

ensureLinkedLiveDir();
run("npm", ["run", "dashboard:export"], baseDir);
syncDashboardFiles();
deployIfRequested();

process.stdout.write(
  JSON.stringify(
    {
      ok: true,
      baseDir,
      liveDir,
      deployed: process.argv.includes("--deploy"),
    },
    null,
    2,
  ) + "\n",
);
