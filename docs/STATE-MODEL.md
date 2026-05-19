# State Model

## Canonical Truth

SQLite is the only canonical writable state in Job Sniper.

Everything else is a projection:
- Google Sheets
- `dashboard/data/dashboard.json`
- the `jobsniper-live` folder

## Operational Rule

When status changes matter operationally:
- update the local DB-backed state first
- then refresh the projections

Recommended commands:

```bash
npm run live:sync
```

## Sheets Policy

Sheets remains supported, but as an integration layer.

- `sheet sync` is part of the normal projection flow
- `sheet pull` is disabled by default
- enabling `sheet pull` requires explicit intent with:

```bash
SNIPER_ENABLE_SHEET_PULL=1
```

This prevents accidental drift where Sheets becomes a second database.

## Live UI Policy

The live dashboard should reflect the DB state, not reinterpret it.

That means:
- outreach rows should be deduped at export time
- weak contact surfaces should be suppressed before presentation
- counts should come from the exported DB snapshot only
