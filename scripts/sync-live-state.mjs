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
  if (!fs.existsSync(path.join(liveDir, ".git"))) {
    throw new Error(`Live dashboard directory is not a standalone git checkout: ${liveDir}`);
  }
  if (!fs.existsSync(path.join(liveDir, "index.html"))) {
    throw new Error(`Live dashboard directory is missing index.html: ${liveDir}`);
  }
}

function syncDashboardFiles() {
  run(
    "rsync",
    [
      "-a",
      "--delete",
      "--exclude",
      ".git/",
      "--exclude",
      ".vercel/",
      "--exclude",
      ".github/",
      "--exclude",
      ".gitignore",
      "--exclude",
      "README.md",
      "--exclude",
      "DEPLOYMENT.md",
      `${path.join(baseDir, "dashboard")}/`,
      `${liveDir}/`,
    ],
    baseDir,
  );
}

ensureLinkedLiveDir();
run("npm", ["run", "dashboard:export"], baseDir);
syncDashboardFiles();

process.stdout.write(
  JSON.stringify(
    {
      ok: true,
      baseDir,
      liveDir,
    },
    null,
    2,
  ) + "\n",
);
