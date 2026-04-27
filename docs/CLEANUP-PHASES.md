# Job Sniper Cleanup Phases

This is the anti-bloat refactor plan for turning Job Sniper into a tighter operation.

## Phase 1: Canonical State and Sync Boundaries

Goal:
- make SQLite the only writable source of truth
- treat Sheets, dashboard JSON, and the live web UI as projections
- reduce manual sync drift

Scope:
- one-command live sync and deploy path
- docs that state the canonical model clearly
- make `sheet pull` opt-in only
- keep dashboard export derived only from DB state

Success criteria:
- local DB is authoritative
- live dashboard can be refreshed in one command
- no default workflow treats Sheets as primary state

## Phase 2: Ingestion and Normalization Cleanup

Goal:
- stop junk earlier
- standardize contact quality and source quality logic

Scope:
- central contact-quality module
- early listing filter before persistence
- shared contact ranking rules across enrichment, routing, and dashboard export
- reduce duplicate scoring heuristics

Success criteria:
- obvious senior and out-of-zone roles are dropped before persistence
- weak contact surfaces are downgraded consistently
- exporter, enrichment, and routing use the same contact-quality rules

## Phase 3: Presentation and Repo Cleanup

Goal:
- make the repo and operator workflow smaller and clearer

Scope:
- clarify architecture and responsibilities
- reduce docs drift
- keep the static live layer as a projection, not a product core
- stage future UI/app work around a simpler state model

Success criteria:
- operator has one clear sync path
- docs describe the real system, not older versions
- the next web-app pass can build on a cleaner core

## Deferred Beyond These Phases

Not finished in this pass:
- full module relocation into `ingestion / normalization / state / presentation`
- replacement of the static dashboard with a full app
- total deletion of every stale script or experiment
- full repo split/repair for the private live repo checkout
