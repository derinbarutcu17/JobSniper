# Hermes Operations Guide for Job Sniper

## Purpose

This guide tells Hermes how to run the combined Job Sniper reliably, safely, and usefully on a schedule.

This is for:

- daily discovery
- daily triage
- Google Sheets sync
- explicit DB-backed outreach state updates
- repeatable local-first operation

This is not for:

- auto-emailing
- auto-applying
- hidden black-box actions

## Canonical repo path

Use the repo that contains this file. The cron wrapper is now path-relative, so it no longer depends on a hardcoded local folder name.

Repo root:

- the parent directory of `scripts/hermes-daily-run.sh`

## Required environment

The Job Sniper runtime should have access to:

- `SNIPER_GOOGLE_SERVICE_ACCOUNT_PATH` or `SNIPER_GOOGLE_SERVICE_ACCOUNT_JSON`
- optional `SNIPER_GOOGLE_SHEET_ID`
- optional `SNIPER_GOOGLE_FOLDER_ID`

If Hermes launches the job through its own environment, put the variables in:

- `~/.hermes/.env`

If cron launches the job directly, make sure the script exports them or sources a file that contains them.

## One-time setup before automation

### 1. Confirm repo health

Run once:

```bash
cd "/path/to/job-sniper-repo"
npm install
npm run typecheck
npm test
npm run sniper -- help
```

Before any Hermes update or pull, make sure the working tree is clean:

```bash
git status --short
```

If it is not empty, commit or stash the local changes first. That keeps future update pulls from hitting restore conflicts.

### 2. Onboard profile manually

Do this once, outside cron:

```bash
npm run sniper -- onboard "/absolute/path/to/cv.pdf"
```

Or:

```bash
npm run sniper -- onboard "Profile text here..."
```

Cron should not re-onboard every day unless the profile is intentionally changed.

### 3. Test Google Sheets once manually

Run:

```bash
npm run sniper -- sheet sync
```

Confirm:

- sheet is created or found
- `Jobs` tab populates
- `Companies` tab populates
- `Contacts` tab populates
- `RunMetrics` tab populates
- daily `Jobs YYYY-MM-DD` tabs exist if the merge plan has been completed

## Recommended daily operating sequence

This is the best default daily run order for Hermes.

### Step 1. Pull manual state from Sheets if explicitly enabled

```bash
npm run sniper -- sheet pull
```

Why:

- preserve human edits
- preserve priority notes
- preserve manual contact overrides
- avoid overwriting yesterday’s decisions

Important:

- `sheet pull` is intentionally disabled by default
- enable it only when you want Sheets to feed manual edits back into SQLite
- use `SNIPER_ENABLE_SHEET_PULL=1` for that mode

### Step 2. Run discovery

```bash
npm run sniper -- run
```

Optional targeted runs:

```bash
npm run sniper -- run --company-watch
npm run sniper -- run --lane design_jobs
npm run sniper -- run --lane ai_coding_jobs
```

### Step 3. Produce action-oriented local outputs

Recommended:

```bash
npm run sniper -- triage 25
npm run sniper -- companies 25
npm run sniper -- stats
npm run sniper -- export json "data/reports/$(date +%F)-sniper-export.json"
```

The most useful operational output is `triage`, not `digest`.

Use:

- `digest` for a score-first snapshot
- `triage` for an action-first queue

### Step 4. Sync back to Sheets

```bash
npm run sniper -- sheet sync
```

This should be the last normal step, so the sheet reflects the latest decisions and metrics.

### Step 5. Refresh the live dashboard snapshot

```bash
npm run live:sync
```

Use:

- `npm run live:sync` to refresh the private live repo from SQLite-derived dashboard data
- `npm run live:deploy` to refresh and publish to Vercel production

## Best cron strategy

### Recommended schedule

Run once or twice per day, not every hour.

Best default:

- morning run for new discovery and triage
- late afternoon run for refresh and sheet sync

Examples:

- 09:00 local time
- 16:30 local time

Reason:

- enough freshness for job hunting
- avoids useless over-crawling
- reduces noisy duplicate work
- keeps Sheets readable day by day

### Recommended cron entries

Example:

```cron
0 9 * * * /bin/zsh "/path/to/job-sniper-repo/scripts/hermes-daily-run.sh" >> "/path/to/job-sniper-repo/data/cron.log" 2>&1
30 16 * * * /bin/zsh "/path/to/job-sniper-repo/scripts/hermes-daily-run.sh" >> "/path/to/job-sniper-repo/data/cron.log" 2>&1
```

## Recommended cron wrapper behavior

The wrapper should:

1. `cd` into the repo root
2. source environment variables
3. ensure `data/reports/` exists
4. optionally run `sheet pull` only when explicitly enabled
5. run `run`
6. save `triage`, `companies`, and `stats` outputs to dated local files
7. run `sheet sync`
8. run `live:sync`
8. exit nonzero on failure

This is better than putting the raw commands directly in crontab because:

- easier debugging
- clearer logs
- one place to change paths/env
- better reproducibility

## What Hermes should optimize for

Hermes should treat Job Sniper as a decision engine, not a scraping treadmill.

Priority order:

1. preserve local data integrity
2. preserve manual notes from Sheets
3. refresh discovery
4. update strategic recommendations
5. sync the latest state

Most important operating rule:

- do not track sent/reached/applied truth in local markdown lists
- update outreach and application state in Job Sniper itself
- then publish that exact DB-backed state to Sheets and the live dashboard

Hermes should prefer:

- `triage` over `digest` for daily review
- `dossier` when a company looks more valuable than a single job post
- `route` and `pitch` when preparing outreach
- `experiments` when checking what is working over time
- `company-state` when a company-level outreach action happened without a clean job application event

## Recommended Hermes playbook

When Hermes is asked to operate Job Sniper, it should use this sequence:

### Daily autonomous mode

1. `sheet pull`
2. `run`
3. `triage 25`
4. `companies 25`
5. `stats`
6. `sheet sync`

### Human-review mode

If the user asks for the best current opportunities:

1. `triage 15`
2. `route <job-id>` for top candidates
3. `pitch <job-id>` for top candidates
4. `dossier <company>` when the company matters more than the exact posting

### Outreach-prep mode

For a chosen target:

1. `route <job-id>`
2. `pitch <job-id>`
3. `contacts <company>`
4. `draft <job-id>`

### Learning mode

After real outreach activity:

1. `contact log ...`
2. `outcome log ...`
3. `experiments`

## Day-by-day Google Sheets results

The most useful day-by-day sheet setup is:

- keep the main `Jobs` tab as the current canonical live board
- keep `RunMetrics` for per-run macro numbers
- add dated `Jobs YYYY-MM-DD` tabs so each run day has a snapshot

This gives:

- one current working board
- one historical run log
- one easy day-by-day audit trail

If daily tabs are not yet merged into V2, do not cut over cron yet. Merge that behavior first.

## Failure policy

If any step fails:

- do not continue blindly
- do not run `sheet sync` if discovery/state generation failed halfway
- write the error to the cron log
- leave the previous successful sheet state intact

Hermes should fail closed, not fail noisy.

## Commands Hermes should know

Core:

- `onboard`
- `run`
- `digest`
- `shortlist`
- `triage`
- `draft`
- `explain`
- `route`
- `pitch`
- `companies`
- `dossier`
- `contacts`
- `enrich company`
- `sheet sync`
- `sheet pull`
- `stats`
- `export json`
- `experiments`
- `contact log`
- `outcome log`

## Explicit non-goals

Hermes must not:

- auto-email people
- auto-submit applications
- rewrite the profile silently
- overwrite manual sheet fields
- spam repeated outreach because a cron job ran twice

## Best final recommendation

Use one wrapper script plus cron.

Do not let cron call a long chain of inline commands directly.

That setup is the most stable, debuggable, and Hermes-friendly way to run Job Sniper every day.
