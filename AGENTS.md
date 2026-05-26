# Job Sniper AGENTS

Job Sniper is a lean daily sourcing engine for Derin.

The product exists to answer one question well:

What should Derin apply to, and which companies should he cold email next?

If a workflow, feature, or edit does not help the daily command:

- find jobs
- find companies
- dedupe
- remember `found` / `applied` / `contacted`
- sync useful rows to Sheets
- write the reports

then it is not part of the primary product.

## Default Operation

Use this by default:

```bash
npm run sniper -- daily
```

Use this for broader sourcing:

```bash
npm run sniper -- daily --deep
```

Use this when Derin says his portfolio, GitHub, CV, or positioning changed:

```bash
npm run sniper -- daily --refresh-profile
```

Useful variants:

```bash
npm run sniper -- daily --json
npm run sniper -- daily --no-sheet
npm run sniper -- daily --reset-sheet
npm run sniper -- daily --no-auto-deep
npm run sniper -- daily --jobs 10 --companies 20
```

## Hermes Autonomy

Hermes should be able to run this repo end-to-end without extra prompting when the task is about sourcing or follow-up drafts.

Use this loop:

1. Run `npm run sniper -- daily` by default.
2. Use `--deep` only when the normal run is thin or when Derin explicitly asks for broader sourcing.
3. Use `--refresh-profile` when Derin changes his portfolio, GitHub, CV, or positioning.
4. Read the JSON report first for decisions, then the Markdown report for human-readable context.
5. Update SQLite-backed state before any mirror sync.
6. Sync Google Sheets only when the task touches outreach or listings.
7. If drafting emails, create Gmail drafts only.
8. Never send emails or submit applications unless Derin explicitly asks.
9. Never guess private inboxes. Use verified public emails or public contact routes only.
10. Never take over the computer just to compose mail. Keep the workflow inside the Gmail drafting path or the repo workflow.

Hermes should prefer these outputs:

- `daily` JSON for decisions
- `daily` Markdown for human review
- SQLite for state mutation
- Gmail drafts for outbound follow-up text

When Hermes needs to continue from a previous sourced batch, it should preserve:

- already contacted companies
- already applied companies
- public contact routes
- the latest memory corrections in `preferences.json` and `outcomes.json`

When Hermes is unsure whether a company is worth keeping, it should keep the signal conservative and leave the lead in the report or memory rather than inventing detail.

## Current Product Shape

The current daily flow should:

- discover jobs Derin can apply to
- discover funded Berlin companies and startups Derin can cold email
- prefer Berlin and Germany-compatible opportunities
- dedupe aggressively by company domain and job canonical key
- remember `found`, `applied`, and `contacted`
- skip already-applied and already-contacted targets
- score for role fit, location fit, language fit, stage, and public route quality
- sync only useful rows to Google Sheets
- write one Markdown report
- write one JSON report

The funded-company path currently includes Berlin-oriented startup/funding sources such as Handpicked Berlin, selected Tech.eu / EU-Startups articles, and a VC-portfolio seed path that must still be corroborated by stronger Berlin/funding evidence before it should dominate recommendations.

## Non-Negotiables

Agents must:

- use `daily` as the default workflow
- read the JSON report before making downstream decisions
- treat SQLite as canonical state
- treat Google Sheets as a mirror only
- use Gmail audit evidence when available
- update memory files when Derin corrects recommendations
- keep the Sheets output readable to humans, not just machine-friendly

Agents must never:

- depend on dashboard state
- manually edit live dashboard data
- send emails
- submit applications
- guess private email patterns
- take over the computer just to compose mail
- revive old multi-command sourcing chains unless debugging

## Canonical State

Primary writable state:

- [`/Users/derin/Desktop/CODING/Job sniper/data/sniper.db`](/Users/derin/Desktop/CODING/Job%20sniper/data/sniper.db)

Stable profile facts:

- [`/Users/derin/Desktop/CODING/Job sniper/config/derin.profile.json`](/Users/derin/Desktop/CODING/Job%20sniper/config/derin.profile.json)

Mutable preference corrections:

- [`/Users/derin/Desktop/CODING/Job sniper/data/memory/preferences.json`](/Users/derin/Desktop/CODING/Job%20sniper/data/memory/preferences.json)

Lightweight recommendation outcomes:

- [`/Users/derin/Desktop/CODING/Job sniper/data/memory/outcomes.json`](/Users/derin/Desktop/CODING/Job%20sniper/data/memory/outcomes.json)

Operational source notes:

- [`/Users/derin/Desktop/CODING/Job sniper/data/memory/source-state.json`](/Users/derin/Desktop/CODING/Job%20sniper/data/memory/source-state.json)

Profile cache:

- [`/Users/derin/Desktop/CODING/Job sniper/data/cache/profile-context.json`](/Users/derin/Desktop/CODING/Job%20sniper/data/cache/profile-context.json)

Optional Gmail audit input:

- [`/Users/derin/Desktop/CODING/Job sniper/data/import/gmail-audit.json`](/Users/derin/Desktop/CODING/Job%20sniper/data/import/gmail-audit.json)

Reports:

- [`/Users/derin/Desktop/CODING/Job sniper/data/reports`](/Users/derin/Desktop/CODING/Job%20sniper/data/reports)

## Derin Profile

Derin is:

- Berlin-based
- a Product Designer / Design Engineer
- strongest when design taste, interface quality, prototyping speed, and AI-assisted product building come together

Positioning:

- polished product interfaces
- design systems
- prototypes
- AI-assisted workflows
- product-minded frontend execution

Do not position him as:

- traditional full-stack engineer
- backend engineer
- ML engineer
- senior software engineer
- pure visual designer only

Portfolio:

- [https://derinb.vercel.app/](https://derinb.vercel.app/)

GitHub:

- [https://github.com/derinbarutcu17](https://github.com/derinbarutcu17)

## Targeting Rules

Accepted roles:

- Product Designer
- UX/UI Designer
- UI Designer
- UX Designer
- Visual Designer
- Design Engineer
- UX Engineer
- Creative Technologist
- Frontend Developer
- Frontend Engineer
- AI Product Builder
- Junior Product Manager
- Presentation Designer
- Design Systems Designer
- Lead Designer when startup, studio, agency, or hands-on small team context is clear
- Head of Design when founding, first-designer, hands-on startup, studio, or agency context is clear

Rejected roles:

- Senior Product Designer
- Senior UX/UI Designer
- Staff Designer
- Principal Product Designer by default
- Director of Design
- VP Design
- Backend Engineer
- DevOps Engineer
- ML Engineer
- Data Scientist
- Data Engineer
- Platform Engineer
- Cloud Engineer
- Sales
- Customer Success

Frontend edge case:

- accept only when the role is clearly UI, UX, interface, design systems, component-library, React, Tailwind, or product-frontend heavy
- reject when backend ownership, infrastructure, Kubernetes, cloud, data pipelines, or API architecture are central

## Geography Rules

Accept:

- Berlin onsite
- Berlin hybrid
- Germany remote
- Germany-wide remote

Downgrade:

- Europe remote when Germany compatibility is unclear
- worldwide remote when Germany compatibility is unclear

Reject:

- Turkey roles
- non-Germany onsite roles
- US-only remote
- UK-only remote
- Canada-only remote
- relocation-only roles outside Germany

## Language Rules

Boost:

- English working language
- English accepted
- German nice-to-have
- international team

Keep but downgrade:

- German-language post with no explicit German requirement

Reject or bury below report threshold:

- German required
- C1 German
- native German
- fluent German mandatory
- Deutsch auf Muttersprachniveau
- verhandlungssicheres Deutsch

## Company Recommendation Rules

Every surfaced company must include:

- company name
- website
- contact route

Valid contact routes:

1. public founder or team email
2. hiring or recruiting email
3. `jobs@` or `careers@`
4. `hello@` or `contact@`
5. contact form
6. LinkedIn profile
7. team page with an identifiable person

Good company signals:

- Berlin or Germany relevance
- startup, studio, agency, or useful product company
- early funding or visible momentum
- AI tooling
- devtools
- creative tools
- SaaS
- visible founder or team
- careers page
- public email or other clear route

Do not over-filter companies. Coverage matters, but no-contact-route companies should not appear in the top cold-email list.

## Gmail Audit Rule

The v1 Gmail path is file-based import, not direct Gmail API dependency.

Input file:

- [`/Users/derin/Desktop/CODING/Job sniper/data/import/gmail-audit.json`](/Users/derin/Desktop/CODING/Job%20sniper/data/import/gmail-audit.json)

Use it to:

- mark `contacted`
- mark `applied`
- skip duplicates in the next daily run
- explain why items were skipped

Store only:

- sender / recipient metadata
- subject
- date
- inferred event
- evidence summary

Never store full email bodies.

If uncertain:

- keep the signal conservative
- prefer no mutation over a wrong mutation

## Sheets Rule

Sheets is a mirror only.

Only two tabs are part of the current product:

- `Jobs`
- `Companies`

The daily sync should:

- update existing rows by canonical key or domain
- append new actionable rows
- preserve `found` / `applied` / `contacted`
- never dump raw scraped noise
- keep the tabs readable to humans with clear headers, row styling, confidence colors, and stage/status cues

If Derin asks for a clean reset, use:

```bash
npm run sniper -- daily --reset-sheet
```

## Reports Rule

Every successful daily run should write:

- one Markdown report
- one JSON report

Agents should prefer the JSON file for machine decisions and the Markdown file for human-readable summaries.

## Memory Update Rule

When Derin corrects recommendations:

- update [`/Users/derin/Desktop/CODING/Job sniper/data/memory/preferences.json`](/Users/derin/Desktop/CODING/Job%20sniper/data/memory/preferences.json)

When Derin says a recommendation was useful, bad, redundant, or misleading:

- update [`/Users/derin/Desktop/CODING/Job sniper/data/memory/outcomes.json`](/Users/derin/Desktop/CODING/Job%20sniper/data/memory/outcomes.json)

When you discover operational sourcing facts that should persist locally:

- update [`/Users/derin/Desktop/CODING/Job sniper/data/memory/source-state.json`](/Users/derin/Desktop/CODING/Job%20sniper/data/memory/source-state.json)

Do not bury mutable memory only in chat or markdown notes.

## Quality Gates

Before you call the run good:

- job recommendations are deduped
- company recommendations are deduped domain-first
- already-contacted companies stay out of the top company list
- already-applied companies stay out of the top company and job lists
- company recommendations always include a usable public route
- German-required roles do not surface as top recommendations
- senior design leadership roles do not float to the top by default
- Berlin and Germany-compatible opportunities dominate the report
- funded Berlin startup leads should beat generic portfolio noise
- both Markdown and JSON artifacts were written
- Sheets sync failure does not erase local reports

## Main Files

- [`/Users/derin/Desktop/CODING/Job sniper/src/daily/daily-engine.ts`](/Users/derin/Desktop/CODING/Job%20sniper/src/daily/daily-engine.ts)
- [`/Users/derin/Desktop/CODING/Job sniper/src/daily/discovery.ts`](/Users/derin/Desktop/CODING/Job%20sniper/src/daily/discovery.ts)
- [`/Users/derin/Desktop/CODING/Job sniper/src/daily/funded-berlin-startups.ts`](/Users/derin/Desktop/CODING/Job%20sniper/src/daily/funded-berlin-startups.ts)
- [`/Users/derin/Desktop/CODING/Job sniper/src/daily/classification.ts`](/Users/derin/Desktop/CODING/Job%20sniper/src/daily/classification.ts)
- [`/Users/derin/Desktop/CODING/Job sniper/src/daily/dedupe.ts`](/Users/derin/Desktop/CODING/Job%20sniper/src/daily/dedupe.ts)
- [`/Users/derin/Desktop/CODING/Job sniper/src/daily/gmail-audit.ts`](/Users/derin/Desktop/CODING/Job%20sniper/src/daily/gmail-audit.ts)
- [`/Users/derin/Desktop/CODING/Job sniper/src/daily/sheets-sync.ts`](/Users/derin/Desktop/CODING/Job%20sniper/src/daily/sheets-sync.ts)
- [`/Users/derin/Desktop/CODING/Job sniper/src/presentation/cli.ts`](/Users/derin/Desktop/CODING/Job%20sniper/src/presentation/cli.ts)

## Legacy Surfaces

These may remain in the repo for debugging, migration safety, or historical tests, but they are not the primary product:

- dashboard export paths
- live dashboard sync flows
- old queue-style automation chains
- route / pitch / draft / dossier as a default workflow
- tomorrow-sourcing report flows

If you touch those surfaces, keep them explicitly secondary to `daily`.
