import fs from "node:fs";
import path from "node:path";
import { openDatabase, getJobById } from "./db.js";
import { loadProfile } from "./profile.js";
import { resolveDataPath } from "./lib/paths.js";
import type { AssetBundleView, JobRecord } from "./types.js";

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function buildCvMarkdown(job: JobRecord, profileSummary: string, toolSignals: string[]): string {
  return [
    `# Targeted CV Brief`,
    "",
    `Role: ${job.title}`,
    `Company: ${job.company_name}`,
    `Location: ${job.location || "Unknown"}`,
    "",
    `## Fit Summary`,
    profileSummary,
    "",
    `## Priority Skills`,
    ...toolSignals.slice(0, 8).map((signal) => `- ${signal}`),
    "",
    `## Tailoring Notes`,
    `- Emphasize ${job.title_family || "role-family"} outcomes relevant to this role.`,
    `- Mirror language from the job description where possible.`,
    `- Keep ATS keywords close to real project evidence.`,
    "",
  ].join("\n");
}

function buildCoverLetter(job: JobRecord): string {
  return [
    `Hello ${job.company_name} team,`,
    "",
    `I am reaching out regarding your ${job.title} opportunity.`,
    `My background combines product execution, design-quality delivery, and practical implementation speed.`,
    "",
    `Why this role is a fit:`,
    `- I can contribute immediately on core responsibilities in your ${job.title_family || "target"} domain.`,
    `- I work comfortably across ambiguous product constraints and tight iteration loops.`,
    "",
    `I would value the chance to discuss how I can support the team.`,
    "",
    `Best regards,`,
  ].join("\n");
}

function buildOutreachNote(job: JobRecord): string {
  return [
    `Subject: ${job.title} - ${job.company_name}`,
    "",
    `Hi ${job.company_name} team,`,
    `I came across your ${job.title} role and wanted to reach out directly.`,
    `I align strongly with the scope and can share focused examples relevant to the role.`,
    `If helpful, I can send a short portfolio walkthrough and tailored CV.`,
  ].join("\n");
}

export function generateAssetBundle(baseDir: string, jobId: number): AssetBundleView {
  const { db } = openDatabase(baseDir);
  const job = getJobById(db, jobId);
  if (!job) {
    throw new Error(`Job ${jobId} not found.`);
  }
  const profile = (() => {
    try {
      return loadProfile(baseDir).profile;
    } catch {
      return {
        summary: "Generalist product and engineering profile.",
        toolSignals: ["product execution", "communication", "delivery"],
      };
    }
  })();
  const bundleDir = resolveDataPath(baseDir, "assets", `job-${jobId}`);
  ensureDir(bundleDir);

  const cvPath = path.join(bundleDir, "cv.md");
  const coverLetterPath = path.join(bundleDir, "cover-letter.md");
  const outreachNotePath = path.join(bundleDir, "outreach-note.md");
  const manifestPath = path.join(bundleDir, "manifest.json");

  fs.writeFileSync(cvPath, `${buildCvMarkdown(job, profile.summary, profile.toolSignals)}\n`);
  fs.writeFileSync(coverLetterPath, `${buildCoverLetter(job)}\n`);
  fs.writeFileSync(outreachNotePath, `${buildOutreachNote(job)}\n`);
  fs.writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        jobId,
        generatedAt: new Date().toISOString(),
        files: {
          cvPath,
          coverLetterPath,
          outreachNotePath,
        },
      },
      null,
      2,
    )}\n`,
  );

  return {
    jobId,
    bundlePath: bundleDir,
    cvPath,
    coverLetterPath,
    outreachNotePath,
  };
}
