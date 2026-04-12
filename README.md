# Job Sniper

`job-sniper` is a local-first job intelligence engine for finding roles, tracking companies, collecting public hiring contacts, and managing a structured outreach workflow.

It is designed to do more than scrape jobs. It helps you decide:

- which roles are actually worth time
- which companies deserve direct outreach
- which route to use: ATS, direct email, founder/team reachout, or watch
- what pitch angle to lead with
- what to sync into Google Sheets for day-to-day management

The project stays deterministic-first and inspectable:

- SQLite is the local source of truth
- discovery, scoring, route, and pitch logic are explicit
- Google Sheets is an integration layer, not the primary database
- no auto-emailing
- no auto-applying
- no black-box “copilot” behavior

## What It Is

Job Sniper is now structured as a local backend core with a clean boundary for a future web app.

Current foundation:

- typed service layer
- typed read models for jobs, companies, contacts, runs, and dossiers
- first-class run records
- role-pack-driven search and scoring
- adapter-style Google Sheets sync
- CLI and OpenClaw/AI Agent skill as presentation layers over the engine

That means the repo is no longer “just a CLI tool.” It is a local domain engine that can later power:

- a browser dashboard
- a local API
- background automation
- Google Sheets workflows

without needing to untangle the core logic again.

## What It Does

- Onboards a profile from raw text or a local file path
- Searches across web search results, RSS feeds, ATS boards, and structured job pages
- Tracks jobs, companies, contacts, manual notes, outreach state, and outcomes
- Scores opportunities against a profile
- Adds a strategic decision layer on top of raw score
- Recommends next action:
  - `apply_now`
  - `cold_email`
  - `enrich_first`
  - `watch`
  - `discard`
- Recommends route:
  - `ats_only`
  - `ats_plus_cold_email`
  - `direct_email_first`
  - `founder_or_team_reachout`
  - `watch_company`
  - `no_action`
- Generates deterministic pitch angles with visible evidence
- Builds company dossiers
- Logs outreach attempts and outcomes
- Syncs live state into Google Sheets and pulls manual edits back

## Talk to It

If you are using an AI Agent, you do not need to think in CLI terms most of the time.

You can say things like:

- “Find me Berlin design-engineering roles.”
- “Show me which companies are worth cold-emailing first.”
- “Open the top opportunities and draft outreach for the best three.”
- “Sync the latest shortlist to Google Sheets.”

The skill command is:

```text
/sniper
```

If your AI Agent surface only exposes skill-wrapper commands, use:

```text
/skill sniper run
```

## Quick Start

Install and verify:

```bash
npm install
npm run typecheck
npm test
npm run sniper -- help
```

Basic flow:

```text
/sniper onboard <cv text or file path>
/sniper run
/sniper triage
/sniper companies
/sniper sheet sync
```

If you want the raw shell entrypoint:

```bash
node ./scripts/run-sniper.mjs <subcommand>
```

## Command Surface

```text
/sniper onboard <text-or-file>
/sniper run [--lane <lane-id>] [--company-watch]
/sniper digest [limit]
/sniper shortlist [limit]
/sniper triage [limit]
/sniper pipeline <job-id-or-url>
/sniper assets <job-id>
/sniper apply-state <job-id> --status <discovered|triaged|asset_ready|applied|contacted|reply_received|interviewing|rejected|archived> [--method <ats|direct_email|founder_reachout|linkedin|other>] [--note <text>]
/sniper draft <job-id>
/sniper explain <job-id>
/sniper route <job-id>
/sniper pitch <job-id>
/sniper companies [limit]
/sniper dossier <company-id-or-key>
/sniper contacts [company-id-or-key]
/sniper enrich company <company-id-or-key>
/sniper contact log <company-id-or-key> --channel <email|linkedin|ats|founder> [--job <job-id>] [--note <text>]
/sniper outcome log <company-id-or-key> --result <no_reply|reply|call|interview|rejected|positive_signal> [--job <job-id>] [--note <text>]
/sniper experiments
/sniper blacklist add [--company | --keyword] [--lane <lane>] <term>
/sniper sheet sync
/sniper sheet pull
/sniper stats
/sniper export json [path]
```

## Typical Workflow

### 1. Onboard a profile

Paste text directly:

```text
/sniper onboard I am a frontend engineer focused on devtools, based in London, open to hybrid and remote roles...
```

Or use a local file:

```text
/sniper onboard /absolute/path/to/cv.pdf
```

### 2. Run discovery

```text
/sniper run
/sniper run --lane design_jobs
/sniper run --lane policy_jobs
/sniper run --company-watch
```

This updates the local database with discovered jobs, companies, contacts, and strategic recommendations.

### 3. Review what deserves time

```text
/sniper digest
/sniper shortlist
/sniper triage
/sniper companies
```

Use:

- `digest` for a score-first list
- `shortlist` for eligible roles
- `triage` for action-first prioritization
- `companies` for company-level scanning

### 4. Inspect the strategy, not just the row

```text
/sniper explain 42
/sniper route 42
/sniper pitch 42
/sniper dossier company:key
```

Use:

- `explain` to understand the score and gates
- `route` to understand the recommended contact/application route
- `pitch` to see the wedge to lead with
- `dossier` to get the company-level brief

### 5. Run the application pipeline

```text
/sniper pipeline 42
/sniper assets 42
/sniper apply-state 42 --status applied --method ats --note submitted via careers page
```

Use:

- `pipeline` to move a scored job into a concrete application-ready state
- `assets` to regenerate CV/cover-letter/outreach assets for a specific job
- `apply-state` to track lifecycle transitions after manual action

### 6. Log outreach and outcomes

```text
/sniper contact log north --channel email --job 42 --note intro sent
/sniper outcome log north --result reply --job 42 --note recruiter replied
/sniper experiments
```

This closes the loop so the system can surface which routes and themes are actually working.

### 7. Sync to Google Sheets

```text
/sniper sheet sync
/sniper sheet pull
```

Use Sheets as the operational board if you want browser-based review and editing without changing git.

## Role Packs and Customization

This project is not tied to one person, one city, or one industry.

The search engine is role-pack-driven. Each lane is defined in `config.json` with:

- `label`
- `type`
- `queries`
- `keywords`
- optional `queryTerms`
- optional `profileSignals`
- optional `titleFamilies`
- optional `mismatchTerms`
- optional `startupTerms`
- optional `companyTerms`

Main customization points:

- `config.json`
  Target markets, lanes, sources, blacklists, and sheet settings
- `profile/cv.md` and `profile/profile.json`
  Local runtime profile files created by onboarding
- role packs
  Add new fields and search lanes without rewriting the engine

Typical customizations:

- switch from one city/country to another
- run remote-only targeting
- use it for one candidate or many different profiles
- add new lanes for fields like policy, biotech, legal ops, data science, climate, research, or recruiting

### Example: custom lane

```json
{
  "lanes": {
    "policy_jobs": {
      "label": "Policy Jobs",
      "type": "job",
      "enabled": true,
      "queries": {
        "tr": [],
        "en": [
          "Berlin climate policy jobs",
          "Germany public affairs analyst roles"
        ]
      },
      "keywords": ["policy analyst", "climate policy", "public affairs"],
      "queryTerms": ["policy analyst", "public policy associate"],
      "profileSignals": ["policy", "climate policy", "research", "public affairs"],
      "titleFamilies": [
        {
          "family": "Policy Analyst",
          "terms": ["policy analyst", "public policy associate"]
        }
      ],
      "mismatchTerms": ["sales", "account executive"]
    }
  },
  "blacklist": {
    "lanes": {
      "policy_jobs": []
    }
  }
}
```

Then run:

```text
/sniper run --lane policy_jobs
/sniper blacklist add --lane policy_jobs --keyword lobbying
```

## Google Sheets

To enable live Sheets sync, provide one of:

- `SNIPER_GOOGLE_SERVICE_ACCOUNT_PATH`
- `SNIPER_GOOGLE_SERVICE_ACCOUNT_JSON`

Optional:

- `SNIPER_GOOGLE_SHEET_ID`
- `SNIPER_GOOGLE_FOLDER_ID`

If no spreadsheet ID is configured, the first sync creates a spreadsheet named `Job Sniper`.

Default tabs:

- `Jobs`
- `Companies`
- `Contacts`
- `RunMetrics`

Manual columns preserved on sync:

- `manual_status`
- `owner_notes`
- `priority`
- `outreach_state`
- `manual_contact_override`

This lets you manage the browser-visible board directly while keeping SQLite as the local source of truth.

## AI and Browser Workflows

### OpenClaw (or other AI Agents) + Sheets

Use Job Sniper to produce the data, then use the sheet as the live board:

- `Jobs` for prioritization and outreach state
- `Companies` for company tracking
- `Contacts` for public contact surfaces
- `RunMetrics` for run-level monitoring

Example:

```text
Open the Job Sniper Google Sheet, find the high-priority rows, review the job pages, and draft outreach for the top 3.
```

### ChatGPT or Gemini

You can export or paste rows and ask for:

- ranking help
- comparison across roles
- rewrite suggestions for outreach
- prep notes before applying

Example:

```text
Here is my Jobs export. Rank the top 10 opportunities by likely interview conversion and explain why.
```

### Notion

This repo does not write to Notion directly, but the practical workflow is:

1. run Job Sniper
2. sync to Sheets
3. mirror selected companies or jobs into Notion
4. use Notion for prep notes, dossier writing, interview prep, or application tracking

## Foundation for the Web App

This repo is now positioned as the backend foundation for a future dashboard.

What already exists:

- typed service layer
- typed read models for jobs, companies, contacts, runs, and dossiers
- first-class run records
- adapter-style Sheets sync
- deterministic pipeline boundaries

What is intentionally not added yet:

- no local HTTP server by default
- no automatic emailing
- no automatic application submission
- no black-box ranking layer

That means the next web app can be built on top of the existing services instead of replacing the engine.

## Privacy and Secrets

Runtime data should stay out of git.

Ignored local state includes:

- `profile/`
- `data/*.db`
- `data/*.html`
- `.env`

Expected secrets come from environment variables, not committed files:

- `SNIPER_GOOGLE_SERVICE_ACCOUNT_PATH`
- `SNIPER_GOOGLE_SERVICE_ACCOUNT_JSON`
- `SNIPER_GOOGLE_SHEET_ID`
- `SNIPER_GOOGLE_FOLDER_ID`

## Repo Structure

- [README.md](README.md)
  Main documentation
- [SKILL.md](SKILL.md)
  Minimal OpenClaw skill wrapper
- [src/services](src/services)
  Engine-facing service boundary
- [src/search](src/search)
  Discovery, crawling, parsing, enrichment
- [src/db.ts](src/db.ts)
  SQLite schema and persistence
- [src/sheets.ts](src/sheets.ts)
  Google Sheets integration
- [test](test)
  Regression, integration, and service-layer coverage
