# Job Sniper — Agent Guide

## Identity

Local-first job and company intelligence engine. Discovers roles, scores them, decides what matters, tracks outreach. Built for CLI and agent operation (Codex, OpenClaw, Hermes).

## Source of Truth

**SQLite** at `data/sniper.db` is the only canonical writable state. Everything else is a projection:
- Live dashboard (`jobsniper-live` repo)
- Google Sheets
- JSON / Markdown exports

## Architecture (4 Layers)

```
src/ingestion/     — scrapers, ATS discovery, crawling, parsing
src/normalization/ — scoring, routing, pitch, filtering, decision
src/state/         — SQLite persistence, services, Sheets adapter
src/presentation/  — CLI, presenters, formatting
```

## File Map

| Path | Purpose |
|---|---|
| `src/presentation/cli.ts` | CLI entry point, all subcommands |
| `src/presentation/app.ts` | App shell wiring commands to services |
| `src/types.ts` | All types (860+ lines), domain model |
| `src/state/db.ts` | SQLite schema, migrations, CRUD (~1200 lines) |
| `src/state/sheets.ts` | Google Sheets sync adapter |
| `src/state/services/jobs-service.ts` | Job query/triage/digest service |
| `src/state/services/tomorrow-sourcing-service.ts` | Tomorrow-sourcing engine |
| `src/normalization/decision.ts` | Recommendation logic (apply/cold-email/watch/discard) |
| `src/normalization/scoring.ts` | Role scoring against profile |
| `src/normalization/route.ts` | Route recommendation logic |
| `src/normalization/config.ts` | Config loading (config.json, lanes, sources) |
| `scripts/export-dashboard-data.ts` | Dashboard JSON export from DB |
| `scripts/sync-live-state.mjs` | Sync to jobsniper-live repo |
| `config.lanes.json` | Search lane definitions |
| `config.sources.json` | Source provider config |
| `config.tomorrow.json` | Tomorrow-sourcing config |

## Current State (as of May 2026)

- Companies: 77
- Active jobs: 8
- Contacts: 53
- Berlin/Germany focused, startup & product-team roles
- Target: junior/mid product/interface/front-end roles

## CLI Reference

```
sniper onboard <text-or-file>            — load/refresh profile
sniper run [--lane <id>] [--company-watch] — run discovery
sniper triage [limit]                    — inspect scored jobs
sniper companies [limit]                 — list companies
sniper dossier <company-id-or-key>       — full company report
sniper contacts [company-id-or-key]      — contact surfaces
sniper draft <job-id>                    — generate outreach draft
sniper apply-state <job-id> --status ... — update pipeline status
sniper company-state <ref> --status ...  — update company outreach
sniper sheet sync [--companies-only]     — sync to Google Sheets
sniper stats                             — pipeline statistics
sniper export json [path]                — export DB to JSON
sniper source tomorrow (report-only)     — tomorrow-sourcing run
```

## Workflow Pattern

1. `onboard` or refresh profile
2. `run` discovery
3. `triage`, `companies`, `dossier` to inspect results
4. `apply-state` / `company-state` to update outreach
5. `sheet sync` to push to Sheets
6. `npm run dashboard:export && npm run live:sync` to refresh dashboard

## Environment Variables

See `.env.example` for the full list. Key ones:
- `SNIPER_GOOGLE_SERVICE_ACCOUNT_JSON` or `SNIPER_GOOGLE_SERVICE_ACCOUNT_PATH`
- `SNIPER_GOOGLE_SHEET_ID`
- `SNIPER_BASE_DIR` (defaults to repo root)
- `CHROME_PATH` for headless browser

## Package Manager & Runtime

- **npm** for installs (`package-lock.json` tracked, `bun.lock` is gitignored)
- **tsx** for running TS (`node --import tsx`)
- **vitest** for tests
- **eslint + prettier** for code quality

## Quality Gates

```
npm run typecheck    — tsc --noEmit
npm run lint         — eslint src/ test/
npm test             — vitest run test/*.test.ts
npm run format:fix   — prettier --write src/ test/
```

## Important Caveats

- `Job sniper 2` is legacy — work in the main repo only
- Live dashboard is at `jobsniper-live` — regenerate from main repo, don't edit directly
- Do not manually edit dashboard data files; use `npm run live:sync`
- Google Sheets is a review layer, not source of truth
- No auto-emailing, no auto-applying by design
- The `tomorrow-sourcing` commands are report-only by default

## Commit Convention

Follow global format: `type(scope): short description` — lowercase, no period.
Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `style`.
