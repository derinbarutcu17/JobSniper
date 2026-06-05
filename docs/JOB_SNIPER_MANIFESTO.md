# Job Sniper Manifesto

## What Job Sniper Is

Job Sniper is a local-first job research and outreach engine that helps a person find good jobs to apply to and good companies to cold email.

It is not a generic CRM.
It is not an auto-apply bot.
It is not a dashboard project.
It is not a terminal-only tool.

It is an app that helps a user answer one question well:

What should I apply to, and what companies should I reach out to, right now?

## The Product Belief

The best job search tools do not just collect listings. They turn messy public data into a focused decision system.

Job Sniper should:
- discover relevant jobs and companies
- ground decisions in the user’s CV
- narrow scope by city
- separate jobs from companies clearly
- help the user decide what to do next
- make outreach drafting easy without taking over the user’s voice
- preserve state so the user never has to start from zero again

## The Core User Flow

The product should feel simple:

1. The user uploads a CV or points the app at a local CV file.
2. The app parses the CV and produces a profile summary.
3. The user selects one active city.
4. The user clicks Run.
5. The app searches jobs and companies for that city.
6. The app dedupes, scores, and ranks the results.
7. The app shows jobs and companies in separate views.
8. The user opens an item and generates a draft prompt.
9. The user marks items as contacted, applied, or skipped.
10. The app remembers that state and never treats it as fresh again.

## What The App Must Do On Day One

The MVP must support:
- CV upload or CV path selection
- profile summary after parsing
- one active city at a time
- a visible run state while research is happening
- separate Jobs and Companies views
- job cards with links, metadata, and draft generation
- company cards with links, metadata, and draft generation
- status actions for contacted, applied, and skipped
- local state persistence
- clear evidence of why a result was surfaced

## What The App Should Feel Like

The app should feel like:
- a serious research tool
- a calm decision interface
- a helper that makes the search feel smaller and more manageable
- a product that respects the user’s time
- a system that is transparent about why it recommends something

It should not feel like:
- a noisy scraper
- a spreadsheet replacement
- a black box
- an automation toy
- a terminal workflow wrapped in a browser

## Product Principles

1. CV is the source of truth for fit.
2. City is the first scope filter.
3. SQLite is the canonical state.
4. Google Sheets is a mirror, not the product.
5. Jobs and companies are separate tracks.
6. Drafting is explicit, not automatic.
7. Status is durable and never re-inferred casually.
8. Every recommendation should be explainable.
9. The user should be able to trust the system without blindly trusting the model.
10. The app should stay local-first until the product is ready to become hosted.

## Jobs Vs Companies

Jobs and companies are different products inside the same app.

Jobs:
- are for applying
- need title, company, location, apply route, and fit reasons
- should support cover letter drafting

Companies:
- are for cold email
- need website, contact route, company type, and fit reasons
- should support cold email drafting

They should not be mixed together visually or conceptually.

## Drafting Behavior

The app should support two draft types:
- cover letter prompts for jobs
- cold email prompts for companies

Draft generation should:
- use the CV as grounding context
- use listing metadata or company metadata
- remain copyable and editable
- not send anything automatically
- not guess private inboxes
- not fake personalization

The point is to help the user draft faster and better, not to replace judgment.

## The Role Of The Profile Summary

The profile summary step matters.

After parsing the CV, the app should say something like:
- what it thinks the user’s positioning is
- what kinds of roles the profile fits
- what should be excluded
- what the strongest signals are

This is important because it creates trust before scoring begins. The user should understand how the app sees them.

## Geography And Scope

The product should start with one active city per run.

The cities should be selectable, not hardcoded into the experience.

The product should be able to grow from:
- Berlin
- Munich
- London
- Amsterdam
- Madrid

And eventually more, without changing the core model.

## The MVP Should Not Try To Do Everything

For the first version, the product should not try to be:
- a full ATS
- a social network
- a mass outreach platform
- a public SaaS with billing logic
- a complex multi-tenant backend

The MVP should focus on:
- discovery
- fit
- review
- drafting
- memory
- repeatability

## Local First, Then Productized

The first version can be local-first and repo-runnable.

That is fine.

The important thing is that the architecture should already feel like a product:
- clear UI
- clear data model
- clear user actions
- clean separation between engine and interface
- room to become hosted later

The long-term shape can become a web service with login, API keys, and usage billing, but the MVP does not need to begin there.

## What Success Looks Like

The first success metric is simple:
- the user gets good jobs and companies surfaced quickly

Secondary success metrics:
- the user understands why results were surfaced
- the user can draft outreach quickly
- the user can mark status cleanly
- the user can run the same system for different cities
- the system feels like a real app, not a prototype

## The Long-Term Vision

Job Sniper should become a real global job research product.

The user should be able to:
- choose a city
- upload a CV
- run research
- get relevant jobs and companies
- draft outreach
- track what happened
- come back tomorrow with the system remembering everything

That is the product.

Not just scraping.
Not just dashboards.
Not just CLI.
A real interface-driven research app.
