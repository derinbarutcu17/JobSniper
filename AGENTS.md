# Job Sniper AGENTS

Job Sniper is a lean daily sourcing engine.

The product exists to answer one question well:

What should the current operator apply to, and which companies should they cold email next?

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

Use this when the profile, GitHub, CV, or positioning changes:

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

## Agent Autonomy

Agents should be able to run this repo end-to-end without extra prompting when the task is about sourcing or follow-up drafts.

Use this loop:

1. Run `npm run sniper -- daily` by default.
2. Use `--deep` only when the normal run is thin or when broader sourcing is explicitly requested.
3. Use `--refresh-profile` when the operator changes portfolio, GitHub, CV, or positioning.
4. Read the JSON report first for decisions, then the Markdown report for human-readable context.
5. Update SQLite-backed state before any mirror sync.
6. Sync Google Sheets only when the task touches outreach or listings.
7. If drafting emails, create Gmail drafts only.
8. Never send emails or submit applications unless explicitly asked.
9. Never guess private inboxes. Use verified public emails or public contact routes only.
10. Never take over the computer just to compose mail. Keep the workflow inside the Gmail drafting path or the repo workflow.

Agents should prefer these outputs:

- `daily` JSON for decisions
- `daily` Markdown for human review
- SQLite for state mutation
- Gmail drafts for outbound follow-up text

When an agent needs to continue from a previous sourced batch, it should preserve:

- already contacted companies
- already applied companies
- public contact routes
- the latest memory corrections in `preferences.json` and `outcomes.json`

When an agent is unsure whether a company is worth keeping, it should keep the signal conservative and leave the lead in the report or memory rather than inventing detail.

## Current Product Shape

The current daily flow should:

- discover jobs the operator can apply to
- discover funded companies and startups the operator can cold email
- prefer Berlin and Germany-compatible opportunities
- dedupe aggressively by company domain and job canonical key
- remember `found`, `applied`, and `contacted`
- skip already-applied and already-contacted targets
- score for role fit, location fit, language fit, stage, and public route quality
- sync only useful rows to Google Sheets
- write one Markdown report
- write one JSON report

The funded-company path currently includes Berlin-oriented startup and funding sources. It should remain corroboration-heavy so portfolio-only leads do not dominate recommendations.

## Non-Negotiables

Agents must:

- use `daily` as the default workflow
- read the JSON report before making downstream decisions
- treat SQLite as canonical state
- treat Google Sheets as a mirror only
- use Gmail audit evidence when available
- update memory files when recommendations are corrected
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

- `data/sniper.db`

Stable profile facts:

- `SNIPER_PROFILE_PATH` or `config/profile.example.json` as the local template

Mutable preference corrections:

- `data/memory/preferences.json`

Lightweight recommendation outcomes:

- `data/memory/outcomes.json`

Operational source notes:

- `data/memory/source-state.json`

Profile cache:

- `data/cache/profile-context.json`

Optional Gmail audit input:

- `data/import/gmail-audit.json`

Reports:

- `data/reports/`

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

Keep but lower confidence:

- German-language posts without an explicit German requirement

Reject or heavily downgrade:

- German required
- C1 German
- native German
- fluent German mandatory
- Deutsch auf Muttersprachlevel

## Contact Rules

Valid company contact routes:

- public founder/team email
- hiring/recruiting email
- `jobs@` / `careers@`
- `hello@` / `contact@`
- contact form
- LinkedIn profile
- team page with identifiable person

Never guess private email patterns.

## Gmail Audit Rule

Use Gmail audit evidence when available to infer:

- `contacted`
- `applied`

If the audit is uncertain, store the signal and do not mutate state.

## Sheets Rule

Sheets should stay compact and readable:

- `Jobs` and `Companies` only
- no raw scraped noise
- no dashboard dependency
- no manual edits in the live mirror

## Memory Update Rule

When the operator corrects a recommendation:

- update `data/memory/preferences.json`
- update `data/memory/outcomes.json` when the recommendation proved useful or bad
- update `data/memory/source-state.json` for verified contact-route changes

## Quality Gates

Before treating a run as good:

- `npm run typecheck` passes
- `npm test` passes
- `daily` writes Markdown and JSON reports
- the top recommendations are deduped
- already contacted or applied companies do not resurface
- company recommendations have a real website plus a contact route
