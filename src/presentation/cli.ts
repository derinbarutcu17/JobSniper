import path from "node:path";
import { fileURLToPath } from "node:url";
import { getBaseDir } from "../lib/paths.js";
import { createApp } from "./app.js";
import { loadConfig } from "../normalization/config.js";
import { getDefaultCompanyWatchLane } from "../normalization/role-packs.js";
import type { SearchLane } from "../types.js";

function help(): string {
  return [
    "sniper <subcommand>",
    "",
    "Commands:",
    "  onboard <text-or-file>",
    "  run [--lane <lane-id>] [--company-watch]",
    "  digest [limit]",
    "  shortlist [limit]",
    "  triage [limit]",
    "  draft <job-id>",
    "  pipeline <job-id-or-url>",
    "  assets <job-id>",
    "  apply-state <job-id> --status <discovered|triaged|asset_ready|applied|contacted|reply_received|interviewing|rejected|archived> [--method <ats|direct_email|founder_reachout|linkedin|other>] [--note <text>]",
    "  explain <job-id>",
    "  route <job-id>",
    "  pitch <job-id>",
    "  blacklist add [--company | --keyword] [--lane <lane>] <term>",
    "  sheet sync [--companies-only]",
    "  sheet pull",
    "  companies [limit]",
    "  dossier <company-id-or-key>",
    "  contacts [company-id-or-key]",
    "  enrich company <company-id-or-key>",
    "  contact log <company-id-or-key> --channel <email|linkedin|ats|founder> [--job <job-id>] [--note <text>]",
    "  company-state <company-id-or-key> --status <reached|sent_email|talking|rejected|archived> [--channel <email|linkedin|ats|founder>] [--job <job-id>] [--note <text>]",
    "  outcome log <company-id-or-key> --result <no_reply|reply|call|interview|rejected|positive_signal> [--job <job-id>] [--note <text>]",
    "  experiments",
    "  requeue <url> [lane]",
    "  sources test",
    "  source tomorrow (report-only)",
    "  stats",
    "  status",
    "  export json [path]",
    "  daily [limit]",
    "  automate daily [--limit-jobs <n>] [--limit-companies <n>] [--dry-run]",
    "  snap job <job-id> [--status <status>] [--method <method>] [--note <text>]",
    "  snap company <company-ref> [--status <status>] [--channel <channel>] [--note <text>]",
  ].join("\n");
}

function parseLane(input: string | undefined, baseDir: string): SearchLane | undefined {
  if (!input) return undefined;
  const config = loadConfig(baseDir);
  if (config.lanes[input]?.enabled) {
    return input;
  }
  throw new Error(`Invalid lane: ${input}. Configured enabled lanes: ${Object.entries(config.lanes).filter(([, lane]) => lane.enabled).map(([lane]) => lane).join(", ")}`);
}

export async function runCli(argv: string[], baseDir = getBaseDir()): Promise<string> {
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    return help();
  }

  const app = createApp(baseDir);

  if (command === "onboard") {
    return app.onboard(rest.join(" "));
  }

  if (command === "run") {
    let lane: SearchLane | undefined;
    let companyWatchOnly = false;
    for (let index = 0; index < rest.length; index += 1) {
      const token = rest[index];
      if (token === "--lane") {
        lane = parseLane(rest[index + 1], baseDir);
        index += 1;
      } else if (token === "--company-watch") {
        companyWatchOnly = true;
      }
    }
    return app.run({ lane, companyWatchOnly });
  }

  if (command === "digest") {
    return app.digest(Number(rest[0] ?? 5));
  }

  if (command === "shortlist") {
    return app.shortlist(Number(rest[0] ?? 10));
  }

  if (command === "triage") {
    return app.triage(Number(rest[0] ?? 10));
  }

  if (command === "draft") {
    const jobId = Number(rest[0]);
    if (!Number.isFinite(jobId)) {
      throw new Error("draft requires a numeric job ID.");
    }
    return app.draft(jobId);
  }

  if (command === "pipeline") {
    const input = rest.join(" ").trim();
    if (!input) {
      throw new Error("pipeline requires a job id or job URL.");
    }
    return app.pipeline(input);
  }

  if (command === "assets") {
    const jobId = Number(rest[0]);
    if (!Number.isFinite(jobId)) {
      throw new Error("assets requires a numeric job ID.");
    }
    return app.assets(jobId);
  }

  if (command === "apply-state") {
    const jobId = Number(rest[0]);
    if (!Number.isFinite(jobId)) {
      throw new Error("apply-state requires a numeric job ID.");
    }
    let status:
      | "discovered"
      | "triaged"
      | "asset_ready"
      | "applied"
      | "contacted"
      | "reply_received"
      | "interviewing"
      | "rejected"
      | "archived"
      | undefined;
    let method: "ats" | "direct_email" | "founder_reachout" | "linkedin" | "other" | undefined;
    let note = "";
    for (let index = 1; index < rest.length; index += 1) {
      const token = rest[index];
      if (token === "--status") {
        status = rest[index + 1] as typeof status;
        index += 1;
      } else if (token === "--method") {
        method = rest[index + 1] as typeof method;
        index += 1;
      } else if (token === "--note") {
        note = rest.slice(index + 1).join(" ");
        break;
      }
    }
    if (!status) {
      throw new Error("apply-state requires --status.");
    }
    return app.applyState({ jobId, status, method, note });
  }

  if (command === "explain") {
    const jobId = Number(rest[0]);
    if (!Number.isFinite(jobId)) {
      throw new Error("explain requires a numeric job ID.");
    }
    return app.explain(jobId);
  }

  if (command === "route") {
    const jobId = Number(rest[0]);
    if (!Number.isFinite(jobId)) {
      throw new Error("route requires a numeric job ID.");
    }
    return app.route(jobId);
  }

  if (command === "pitch") {
    const jobId = Number(rest[0]);
    if (!Number.isFinite(jobId)) {
      throw new Error("pitch requires a numeric job ID.");
    }
    return app.pitch(jobId);
  }

  if (command === "blacklist" && rest[0] === "add") {
    let mode: "company" | "keyword" = "keyword";
    let lane: SearchLane | undefined;
    const terms: string[] = [];
    for (let index = 1; index < rest.length; index += 1) {
      const token = rest[index];
      if (token === "--company") {
        mode = "company";
      } else if (token === "--keyword") {
        mode = "keyword";
      } else if (token === "--lane") {
        lane = parseLane(rest[index + 1], baseDir);
        index += 1;
      } else {
        terms.push(token);
      }
    }
    const term = terms.join(" ").trim();
    if (!term) {
      throw new Error("blacklist add requires a company or keyword.");
    }
    return app.blacklistAdd({ term, mode, lane });
  }

  if (command === "sheet" && rest[0] === "sync") {
    const companiesOnly = rest.includes("--companies-only");
    return app.sheetSync(companiesOnly ? "companies_only" : "all");
  }

  if (command === "sheet" && rest[0] === "pull") {
    return app.sheetPull();
  }

  if (command === "companies") {
    return app.companies(Number(rest[0] ?? 10));
  }

  if (command === "dossier") {
    const companyRef = rest.join(" ").trim();
    if (!companyRef) throw new Error("dossier requires a company id or key.");
    return app.dossier(companyRef);
  }

  if (command === "contacts") {
    return app.contacts(rest[0]);
  }

  if (command === "enrich" && rest[0] === "company") {
    const companyRef = rest.slice(1).join(" ").trim();
    if (!companyRef) {
      throw new Error("enrich company requires a company id or key.");
    }
    return app.enrichCompany(companyRef);
  }

  if (command === "contact" && rest[0] === "log") {
    const companyRef = rest[1];
    if (!companyRef) throw new Error("contact log requires a company id or key.");
    let channel: "email" | "linkedin" | "ats" | "founder" | undefined;
    let jobId: number | undefined;
    let note = "";
    for (let index = 2; index < rest.length; index += 1) {
      const token = rest[index];
      if (token === "--channel") {
        channel = rest[index + 1] as typeof channel;
        index += 1;
      } else if (token === "--job") {
        jobId = Number(rest[index + 1]);
        index += 1;
      } else if (token === "--note") {
        note = rest.slice(index + 1).join(" ");
        break;
      }
    }
    if (!channel) throw new Error("contact log requires --channel.");
    return app.contactLog({ companyRef, channel, jobId, note });
  }

  if (command === "company-state") {
    const companyRef = rest[0];
    if (!companyRef) throw new Error("company-state requires a company id or key.");
    let status: "reached" | "sent_email" | "talking" | "rejected" | "archived" | undefined;
    let channel: "email" | "linkedin" | "ats" | "founder" | undefined;
    let jobId: number | undefined;
    let note = "";
    for (let index = 1; index < rest.length; index += 1) {
      const token = rest[index];
      if (token === "--status") {
        status = rest[index + 1] as typeof status;
        index += 1;
      } else if (token === "--channel") {
        channel = rest[index + 1] as typeof channel;
        index += 1;
      } else if (token === "--job") {
        jobId = Number(rest[index + 1]);
        index += 1;
      } else if (token === "--note") {
        note = rest.slice(index + 1).join(" ");
        break;
      }
    }
    if (!status) throw new Error("company-state requires --status.");
    return app.companyState({ companyRef, status, channel, jobId, note });
  }

  if (command === "outcome" && rest[0] === "log") {
    const companyRef = rest[1];
    if (!companyRef) throw new Error("outcome log requires a company id or key.");
    let result: "no_reply" | "reply" | "call" | "interview" | "rejected" | "positive_signal" | undefined;
    let jobId: number | undefined;
    let note = "";
    for (let index = 2; index < rest.length; index += 1) {
      const token = rest[index];
      if (token === "--result") {
        result = rest[index + 1] as typeof result;
        index += 1;
      } else if (token === "--job") {
        jobId = Number(rest[index + 1]);
        index += 1;
      } else if (token === "--note") {
        note = rest.slice(index + 1).join(" ");
        break;
      }
    }
    if (!result) throw new Error("outcome log requires --result.");
    return app.outcomeLog({ companyRef, result, jobId, note });
  }

  if (command === "experiments") {
    return app.experiments();
  }

  if (command === "requeue") {
    const url = rest[0];
    if (!url) {
      throw new Error("requeue requires a URL.");
    }
    return app.requeue(url, parseLane(rest[1], baseDir) ?? getDefaultCompanyWatchLane(loadConfig(baseDir)));
  }

  if (command === "sources" && rest[0] === "test") {
    return app.sourcesTest();
  }

  if (command === "source" && rest[0] === "tomorrow") {
    let outputPath: string | undefined;
    let jsonPath: string | undefined;
    let pdfPath: string | undefined;
    for (let index = 1; index < rest.length; index += 1) {
      const token = rest[index];
      if (token === "--output") {
        outputPath = rest[index + 1];
        index += 1;
      } else if (token === "--json") {
        jsonPath = rest[index + 1];
        index += 1;
      } else if (token === "--pdf-path") {
        pdfPath = rest[index + 1];
        index += 1;
      }
    }
    return app.sourceTomorrow({ outputPath, jsonPath, pdfPath });
  }

  if (command === "daily") {
    return app.daily(Number(rest[0] ?? 10));
  }

  if (command === "automate" && rest[0] === "daily") {
    let limitJobs: number | undefined;
    let limitCompanies: number | undefined;
    let dryRun = false;
    for (let index = 1; index < rest.length; index += 1) {
      const token = rest[index];
      if (token === "--limit-jobs") {
        limitJobs = Number(rest[index + 1]);
        index += 1;
      } else if (token === "--limit-companies") {
        limitCompanies = Number(rest[index + 1]);
        index += 1;
      } else if (token === "--dry-run") {
        dryRun = true;
      }
    }
    return app.automateDaily({ limitJobs, limitCompanies, dryRun });
  }

  if (command === "stats") {
    return app.stats();
  }

  if (command === "status") {
    return app.status();
  }

  if (command === "export" && rest[0] === "json") {
    return app.exportJson(rest[1]);
  }

  throw new Error(`Unknown command: ${command}\n\n${help()}`);
}

const executedPath = process.argv[1] ? path.basename(process.argv[1]) : "";
const directExecution =
  (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) ||
  executedPath === "cli.ts" ||
  executedPath === "cli.js";

if (directExecution) {
  runCli(process.argv.slice(2))
    .then((output) => {
      process.stdout.write(`${output}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
