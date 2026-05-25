# Hermes Daily Job Sniper — Cron Job

**Cron:** 9:00 AM Europe/Berlin, Monday–Friday
**CWD:** `/Users/derin/Desktop/CODING/Job sniper`
**Output:** `daily-reports/` in the project root

## Instructions

Run sequentially. Save report to `daily-reports/{YYYY-MM-DD}.md`. Deliver summary via Telegram.

### Step 1 — Discover

```bash
npm run sniper -- run --company-watch
npm run sniper -- run
```

### Step 2 — Digest

```bash
npm run sniper -- daily
```

### Step 3 — Cross-reference

Read `/Users/derin/Desktop/CODING/memory/job-search-source-of-truth.md`. Remove any company already in the "Already Applied / Contacted" list from your recommendations.

### Step 4 — Filter recommendations

#### Apply
`[APPLY]` jobs where title matches: Design Engineer, Creative Technologist, Product Designer, UI/UX Designer, UX Engineer, AI Product Builder, Frontend Engineer.
Exclude: Senior/Lead/Manager/Director/Head/VP/Principal/Staff, pure AI/ML Engineer, Backend Engineer, DevOps.

#### Cold Email
`[EMAIL]` companies that are Berlin startups, not yet contacted, and fit Derin's profile (design + frontend + AI overlap).

### Step 5 — Write report

```markdown
## Daily Report — {date}

### Apply
- {company} — {title} — {score} — {route}
  URL: {url}

### Cold Email
- {company} — {domain}

### Next Steps
1. sniper draft {job-id}
2. sniper route {job-id}
3. sniper dossier {company}
```

Keep to 3-5 items total. If nothing surfaced, report "No new matches today."

### Step 6 — Deliver

Send the report to Derin on Telegram. End with a clear next-action question, e.g. "Want me to draft any of these?"
