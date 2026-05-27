# Lean Daily Sourcing Spec

This repo is being operated as a single-command sourcing tool.

## Product Goal

One command should:

- find jobs the current profile can apply to
- find companies the current profile can cold email
- dedupe aggressively
- remember `found`, `applied`, and `contacted`
- avoid already-contacted and already-applied targets
- sync useful rows to Google Sheets
- write one Markdown report
- write one JSON report

## Main Command

```bash
npm run sniper -- daily
```

Variants:

```bash
npm run sniper -- daily --deep
npm run sniper -- daily --refresh-profile
npm run sniper -- daily --json
npm run sniper -- daily --no-sheet
npm run sniper -- daily --no-auto-deep
npm run sniper -- daily --jobs 10 --companies 20
```

## Hard Constraints

- SQLite is canonical.
- Dashboard is not required.
- Sheets is a mirror, not a database.
- Never send emails.
- Never submit applications.
- Never guess private email addresses.
- Do not preserve old complexity unless it directly helps the daily sourcing flow.

## Fit Rules

- Berlin onsite or hybrid is best.
- Germany remote is valid.
- Europe remote is downgrade-only unless Germany compatibility is clear.
- Senior design leadership roles should not surface by default.
- Frontend roles must be UI or product heavy, not backend heavy.
- German-language posts can stay with lower confidence when requirement is unclear.
- Strong German requirements should stay out of the top report.

## Output Contract

Every successful run should produce:

- one Markdown report in `data/reports/`
- one JSON report in `data/reports/`

## Operational Memory

- Stable profile facts: `SNIPER_PROFILE_PATH` or `config/profile.example.json`
- Preference corrections: `data/memory/preferences.json`
- Recommendation outcomes: `data/memory/outcomes.json`
- Cached profile context: `data/cache/profile-context.json`
