# Job Sniper

`job-sniper` is a local-first job and company intelligence engine for people and agents who want a cleaner way to discover opportunities, rank them, track outreach, and keep everything in sync.

It does three things well:

- scrapes jobs, companies, and public contact surfaces
- judges which results are actually worth attention
- publishes the working state to a live dashboard and optional Google Sheets

This repo is built for a practical workflow, not demo theatrics:

- SQLite is the canonical source of truth
- the scraper is deterministic and inspectable
- the judgment layer is explicit, not black-box
- the web UI and Sheets are mirrors of local state
- no auto-emailing
- no auto-applying

## Why It Exists

Most job tools are weak in one of two ways:

- they find a lot of noise
- or they track data without helping you decide what matters

Job Sniper is meant to sit in the useful middle.

It helps a human or an LLM answer:

- What jobs are live right now?
- Which companies are actually relevant?
- Which opportunities are reachable by ATS, direct email, or founder/team outreach?
- Which rows are weak and should be ignored?
- What has already been contacted, applied to, rejected, or moved forward?

## Who It Is For

Job Sniper is useful if you want a system that can be run by:

- you directly in the terminal
- an LLM agent like Codex, OpenClaw, or Hermes
- a lightweight automation workflow

It is especially good for workflows where:

- you care about company discovery, not just job board scraping
- you want public contact surfaces, not just job links
- you want one clean state model across local data, dashboard, and Sheets
- you want to review and control decisions instead of trusting hidden automation

## What It Does

- Onboards a profile from text or file input
- Searches across ATS boards, RSS, direct board adapters, company sites, and search providers
- Normalizes jobs, companies, and contacts into one SQLite-backed state model
- Scores opportunities against your profile
- Adds a deterministic judgment layer on top of raw scoring
- Recommends a next action such as `apply_now`, `cold_email`, `watch`, or `discard`
- Recommends a route such as `ats_only`, `direct_email_first`, or `founder_or_team_reachout`
- Tracks outreach, applications, replies, interviews, and rejections
- Supports explicit company-level outreach state updates without requiring a fake job row
- Syncs state into Google Sheets
- Exports a live dashboard snapshot for the private web UI

## How It Thinks

Job Sniper is not just a scraper.

Internally it is split into four clear layers:

- `src/ingestion`
  Scrapers, job-board adapters, ATS discovery, crawling, parsing
- `src/normalization`
  Profile inference, scoring, routing, pitch logic, filtering, canonicalization
- `src/state`
  SQLite persistence, services, run records, Sheets adapter
- `src/presentation`
  CLI, presenters, application-facing formatting

That structure matters because it keeps:

- scraping separate from judgment
- judgment separate from persistence
- persistence separate from presentation

## Source of Truth

This is the operating rule:

- SQLite is the only canonical writable state

Everything else is a projection:

- the live dashboard
- Vercel deployment
- Google Sheets
- JSON exports

That means:

- if local state changes, the mirrors should be refreshed
- Sheets should not be treated as the primary database
- `sheet pull` is intentionally opt-in only

If you want reverse sync from Sheets, enable it explicitly:

```bash
SNIPER_ENABLE_SHEET_PULL=1 npm run sniper -- sheet pull
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

```bash
npm run sniper -- onboard "/absolute/path/to/cv.pdf"
npm run sniper -- run
npm run sniper -- triage
npm run sniper -- companies
npm run sniper -- sheet sync
npm run live:sync
```

Raw shell entrypoint:

```bash
node ./scripts/run-sniper.mjs <subcommand>
```

## LLM / Agent Usage

This repo is designed to be easy for an agent to operate.

Good prompts:

- “Run Job Sniper and show me the top 15 Berlin opportunities.”
- “Find the best cold-email targets with verified public contact surfaces.”
- “Sync the latest state to Sheets and refresh the live dashboard.”
- “Show me which companies are already contacted so we do not duplicate outreach.”

Typical agent workflow:

1. onboard or refresh the profile
2. run discovery
3. inspect `triage`, `companies`, `route`, and `dossier`
4. update application or outreach state
5. sync Sheets
6. refresh the live dashboard

Canonical rule:

- do not update sent/reached/applied state in markdown files
- update it in Job Sniper only
- then regenerate Sheets and the live dashboard from that DB-backed state

## CLI Commands

```text
/sniper onboard <text-or-file>
/sniper run [--lane <lane-id>] [--company-watch]
/sniper digest [limit]
/sniper shortlist [limit]
/sniper triage [limit]
/sniper draft <job-id>
/sniper explain <job-id>
/sniper route <job-id>
/sniper pitch <job-id>
/sniper pipeline <job-id-or-url>
/sniper assets <job-id>
/sniper apply-state <job-id> --status <discovered|triaged|asset_ready|applied|contacted|reply_received|interviewing|rejected|archived> [--method <ats|direct_email|founder_reachout|linkedin|other>] [--note <text>]
/sniper companies [limit]
/sniper dossier <company-id-or-key>
/sniper contacts [company-id-or-key]
/sniper enrich company <company-id-or-key>
/sniper contact log <company-id-or-key> --channel <email|linkedin|ats|founder> [--job <job-id>] [--note <text>]
/sniper company-state <company-id-or-key> --status <reached|sent_email|talking|rejected|archived> [--channel <email|linkedin|ats|founder>] [--job <job-id>] [--note <text>]
/sniper outcome log <company-id-or-key> --result <no_reply|reply|call|interview|rejected|positive_signal> [--job <job-id>] [--note <text>]
/sniper experiments
/sniper blacklist add [--company | --keyword] [--lane <lane>] <term>
/sniper sheet sync [--companies-only]
/sniper sheet pull
/sniper stats
/sniper export json [path]
```

## Typical Workflow

### 1. Onboard a profile

```bash
npm run sniper -- onboard "/absolute/path/to/cv.pdf"
```

Or:

```bash
npm run sniper -- onboard "Designer and product builder based in Berlin..."
```

### 2. Run discovery

```bash
npm run sniper -- run
npm run sniper -- run --lane design_jobs
npm run sniper -- run --lane student_jobs
npm run sniper -- run --company-watch
```

### 3. Review what deserves attention

```bash
npm run sniper -- digest
npm run sniper -- shortlist
npm run sniper -- triage
npm run sniper -- companies
```

Use:

- `digest` for score-first review
- `shortlist` for eligible roles
- `triage` for action-first review
- `companies` for company-level scanning

### 4. Inspect the judgment layer

```bash
npm run sniper -- explain 42
npm run sniper -- route 42
npm run sniper -- pitch 42
npm run sniper -- dossier company:key
```

### 5. Track real action

```bash
npm run sniper -- apply-state 42 --status applied --method ats --note submitted via careers page
npm run sniper -- company-state company:key --status sent_email --channel email --note intro sent
npm run sniper -- contact log company:key --channel email --job 42 --note intro sent
npm run sniper -- outcome log company:key --result reply --job 42 --note recruiter replied
```

Use:

- `apply-state` for specific job applications
- `company-state` for company-level outreach truth such as reached, sent email, talking, rejected, or archived
- `contact log` and `outcome log` when you want explicit event history alongside the derived state model

### 6. Sync projections

```bash
npm run sniper -- sheet sync
npm run live:sync
```

Deploy the live dashboard:

```bash
npm run live:deploy
```

## Live Web UI

The private live dashboard is a published projection of the current SQLite state.

It is meant for:

- reviewing companies
- reviewing active jobs
- seeing already-contacted / already-applied rows
- checking pipeline state from anywhere

It is not a second database.

Current deployment flow:

1. update SQLite-backed state
2. run `npm run live:sync`
3. run `npm run live:deploy` when you want production updated

Generated status artifacts now include:

- `dashboard/data/outreach-status.json`
- `dashboard/data/outreach-status.md`

## Google Sheets

Google Sheets is supported as an operational mirror.

Use it for:

- browser-visible review
- manual notes
- lightweight team or agent visibility

Do not use it as the canonical store.

Environment variables:

- `SNIPER_GOOGLE_SERVICE_ACCOUNT_PATH`
- `SNIPER_GOOGLE_SERVICE_ACCOUNT_JSON`
- `SNIPER_GOOGLE_SHEET_ID`
- `SNIPER_GOOGLE_FOLDER_ID`

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

## Role Packs and Customization

Job Sniper is field-agnostic and profile-driven.

It is not tied to one city, one person, or one profession.

Lanes are driven by role-pack configuration in `config.json`, including:

- labels
- lane types
- search queries
- keywords
- title families
- profile signals
- mismatch terms
- startup or company terms

Built-in presets currently include:

- `design_jobs`
- `ai_coding_jobs`
- `student_jobs`
- `company_watch`

That means you can adapt it to:

- a different city
- a different country
- a different profession
- a different candidate profile

without rewriting the engine.

## Architecture Notes

The core repo is intentionally leaner now:

- source adapters and scraping logic live in `src/ingestion`
- data quality and judgment live in `src/normalization`
- persistence and services live in `src/state`
- CLI-facing output lives in `src/presentation`

Compatibility re-export files still exist at older `src/*` paths so the current scripts and tests stay stable while the cleaner structure becomes the real internal boundary.

## Privacy

Runtime state should stay local and out of git.

Ignored or local-only data includes:

- `profile/`
- `data/*.db`
- `data/*.html`
- `.env`

Secrets should come from environment variables, not committed files.

## Repo Map

- [README.md](/Users/derin/Desktop/CODING/Job%20sniper/README.md)
  Main project documentation
- [SKILL.md](/Users/derin/Desktop/CODING/Job%20sniper/SKILL.md)
  Minimal skill wrapper
- [docs/STATE-MODEL.md](/Users/derin/Desktop/CODING/Job%20sniper/docs/STATE-MODEL.md)
  State ownership and sync model
- [docs/CLEANUP-PHASES.md](/Users/derin/Desktop/CODING/Job%20sniper/docs/CLEANUP-PHASES.md)
  Cleanup and anti-bloat notes
- [src/ingestion](/Users/derin/Desktop/CODING/Job%20sniper/src/ingestion)
  Scraping and discovery
- [src/normalization](/Users/derin/Desktop/CODING/Job%20sniper/src/normalization)
  Filtering, scoring, routing, judgment
- [src/state](/Users/derin/Desktop/CODING/Job%20sniper/src/state)
  SQLite, services, sync state
- [src/presentation](/Users/derin/Desktop/CODING/Job%20sniper/src/presentation)
  CLI and presenter layer
- [test](/Users/derin/Desktop/CODING/Job%20sniper/test)
  Regression, parser, and service coverage
