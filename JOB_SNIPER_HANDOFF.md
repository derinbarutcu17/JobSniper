# Job Sniper Handoff

## Source of Truth

Use this note as the working source of truth for Job Sniper in the next chat.

## What Job Sniper Is

- Repo: `<repo-root>`
- Purpose: local-first job and company intelligence engine
- Core job: discover opportunities, score them, decide what matters, and keep outreach state in sync
- It is not a generic CRM and not an auto-apply tool
- It is built to be used by a human or by agents like Codex, OpenClaw, or Hermes

## Canonical State

- SQLite is the only canonical writable state
- Main database: `data/sniper.db`
- Everything else is a projection or export:
  - live dashboard repo
  - Google Sheets
  - JSON / Markdown reports

## Live Mirrors

- Private live dashboard repo: `<live-mirror-repo>`
- Do not edit dashboard data there manually
- Refresh it from the main repo with:
  - `npm run live:sync`
- Optional Sheets sync is also a mirror, not the source of truth

## Current Repo Shape

Important paths in the main repo:

- CLI and app shell:
  - `src/presentation/cli.ts`
  - `src/presentation/app.ts`
- Discovery and scraping:
  - `src/ingestion/search/*`
- Scoring and judgment:
  - `src/normalization/*`
- Persistence and services:
  - `src/state/*`
- Reports and exports:
  - `scripts/export-dashboard-data.ts`
  - `scripts/sync-live-state.mjs`

## Current Operating Rules

- Keep already-reached and applied company lists deduped
- Do not let historical draft or prep logs create duplicate outreach rows unless they are genuinely separate later actions
- For applied tracking, Gmail Sent is the authoritative external audit source when available
- When the operator gives status updates like applied, contacted, or rejected, update the live dashboard source state as part of the same task
- Keep scope tight and avoid speculative feature drift

## Current Workflow Pattern

The normal flow is:

1. onboard or refresh the profile
2. run discovery
3. inspect `triage`, `companies`, `route`, and `dossier`
4. update outreach or application state in SQLite-backed state
5. sync Sheets if needed
6. refresh the live dashboard

## Useful CLI Surface

Common commands:

- `/sniper onboard <text-or-file>`
- `/sniper run [--lane <lane-id>] [--company-watch]`
- `/sniper triage [limit]`
- `/sniper companies [limit]`
- `/sniper dossier <company-id-or-key>`
- `/sniper contacts [company-id-or-key]`
- `/sniper sheet sync [--companies-only]`
- `/sniper sheet pull`
- `/sniper stats`
- `/sniper export json [path]`

## Current Live Snapshot

From the current exported dashboard state:

- companies: 77
- direct contacts: 28
- active jobs: 1
- reached: 0
- sent emails: 3
- applications: 0
- talking: 0
- rejected: 1
- applied: 0
- contacted: 3

Example live rows currently include companies like:

- Pandata GmbH
- Langfuse
- Hera AI
- Moving Parts
- Tyles
- koppla

## Recent Useful Focus

- There is an active report-only tomorrow-sourcing workflow in the repo history
- It should:
  - produce reports only
  - use Gmail Sent as the dedupe source when available
  - respect the seed exclusion list
  - avoid mutating pipeline, Sheets, or state unless the task explicitly says to

## Important Caveats

- The repo has a separate live dashboard mirror, but that mirror is not the source of truth
- There is also an older `Job sniper 2` clone in the workspace
- Treat `Job sniper 2` as legacy unless a task explicitly says to merge or compare it
- Do not manually edit dashboard files in the live mirror; regenerate them from the main repo

## Best Next Step For A Fresh Chat

- Continue from the main `Job sniper` repo
- Inspect the current task or requested change
- Update the SQLite-backed source state first
- Then regenerate Sheets and the live dashboard if the task touches outreach or listings
