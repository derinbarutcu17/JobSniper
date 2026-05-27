# Job Sniper

Job Sniper is a local-first sourcing engine for job seekers, operators, and AI agents.

It does one job well:

- find jobs people can apply to
- find companies, startups, studios, and agencies people can cold email

It then dedupes aggressively, remembers what is `found`, `contacted`, and `applied`, syncs only useful rows to Google Sheets, and writes one Markdown report plus one JSON report for agents.

SQLite is the source of truth. Google Sheets is a mirror. The old dashboard flow is legacy.

## Quick Start

```bash
npm install
npm run typecheck
npm test
npm run sniper -- daily --no-sheet --json
npm run sniper -- daily
```

## The Main Command

Daily sourcing:

```bash
npm run sniper -- daily
```

Deep sourcing:

```bash
npm run sniper -- daily --deep
```

Refresh the profile cache:

```bash
npm run sniper -- daily --refresh-profile
```

Useful variants:

```bash
npm run sniper -- daily --json
npm run sniper -- daily --no-sheet
npm run sniper -- daily --no-auto-deep
npm run sniper -- daily --jobs 10 --companies 20
```

## What The Daily Run Does

The daily command:

1. loads the current profile and cache
2. imports Gmail audit signals when available
3. discovers jobs and companies
4. dedupes aggressively
5. scores candidates with deterministic rules
6. skips already-contacted and already-applied targets
7. syncs useful rows to Google Sheets unless disabled
8. writes a Markdown report and a JSON report

Reports are written to `data/reports/`.

## Normal vs Deep

Normal mode targets:

- 7 jobs
- 10 companies
- intended to stay within about 5 minutes

Deep mode targets:

- 15 jobs
- 25 companies
- intended to stay within about 10 minutes

Auto-deep:

- if normal mode finds fewer than 2 useful jobs or fewer than 2 useful companies, it reruns in deep mode unless `--no-auto-deep` is passed

## Profile And Cache

Stable profile facts live in a private path supplied via `SNIPER_PROFILE_PATH`.

`config/profile.example.json` shows the expected shape.

Cached context lives in `data/cache/profile-context.json`.

Default cache TTL:

- 7 days

If portfolio or GitHub fetching fails, Job Sniper falls back to stale cache or the stable profile config instead of failing the run.

## Gmail Audit

Optional Gmail audit input file:

- `data/import/gmail-audit.json`

Use it to mark:

- `contacted`
- `applied`

It also helps keep already-contacted and already-applied companies out of the daily recommendations.

## Google Sheets

Sheets is a mirror, not the database.

Only two tabs matter:

- `Jobs`
- `Companies`

Sync only actionable recommendations, not raw scraped items.

## State Model

The exposed operating states are:

- `found`
- `contacted`
- `applied`

SQLite keeps the operational history underneath that simple surface.

## For LLM Agents

This repo is designed to be operated by humans or agents like Hermes, OpenClaw, or Codex.

### Default Operating Rule

Use this by default:

```bash
npm run sniper -- daily
```

Use this when the profile, GitHub, portfolio, CV, or positioning changes:

```bash
npm run sniper -- daily --refresh-profile
```

Use this for broader sourcing:

```bash
npm run sniper -- daily --deep
```

### What Agents Should Read First

Before making decisions, agents should read:

- the latest JSON report from `data/reports/`
- `AGENTS.md`
- the current profile config
- `data/memory/preferences.json`
- `data/memory/outcomes.json`

### What Agents Must Respect

Agents must:

- treat SQLite as canonical state
- treat Google Sheets as a mirror only
- never send emails
- never submit applications
- never guess private email addresses
- update memory when recommendations are corrected
- keep the sheet readable for humans, not just machines

Agents must not:

- depend on dashboard state
- manually edit live dashboard data
- use old multi-command sourcing chains unless debugging
- treat raw scraped items as recommendations

### Decision Flow For Agents

1. Run `daily`
2. Read the JSON report
3. Check skipped items and dedupe reasons
4. Update SQLite-backed state if the user gave a status update
5. Sync Sheets only if outreach or listings changed
6. Use Gmail audit evidence before marking applied/contacted

### Output Expectations

The daily run produces:

- one Markdown report for humans
- one JSON report for agents
- optional Google Sheets mirror updates
- optional profile cache refresh

## Scripts

Main scripts:

```bash
npm run sniper -- daily
npm run daily
npm run daily:deep
npm run typecheck
npm test
```

Legacy scripts still exist with `:legacy` suffixes when needed for debugging.
