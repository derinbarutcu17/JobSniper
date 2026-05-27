---
name: sniper
description: "Lean daily sourcing skill for job seekers. Use it to find jobs to apply to and companies or startups to cold email."
user-invocable: true
metadata: { "openclaw": { "requires": { "bins": ["node", "npm"] } } }
---

# Sniper

Use this skill when the operator wants jobs to apply to or companies, startups, studios, or agencies to cold email.

Main command:

```bash
node {baseDir}/scripts/run-sniper.mjs daily
```

Deep mode:

```bash
node {baseDir}/scripts/run-sniper.mjs daily --deep
```

Refresh profile:

```bash
node {baseDir}/scripts/run-sniper.mjs daily --refresh-profile
```

Rules:

- find both jobs and cold-email targets
- target Berlin onsite or hybrid and Germany remote
- sync useful rows to Google Sheets
- track only `found`, `applied`, and `contacted`
- never send emails
- never submit applications
- never use dashboard state

Useful variants:

```bash
node {baseDir}/scripts/run-sniper.mjs daily --json
node {baseDir}/scripts/run-sniper.mjs daily --no-sheet
node {baseDir}/scripts/run-sniper.mjs daily --no-auto-deep
node {baseDir}/scripts/run-sniper.mjs daily --jobs 10 --companies 20
```
