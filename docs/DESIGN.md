# Job Sniper Canon Design Language

This document is the visual source of truth for Job Sniper.

Use it when designing new UI in Stitch, Figma, or code. The goal is to keep the product feeling like one coherent research workspace as it grows from a local-first MVP into a broader global tool.

## 1. Visual Theme & Atmosphere

The canonical look is a calm, premium, airy research workspace.

It should feel:
- simple, but not sparse
- refined, but not decorative
- trustworthy, but not sterile
- modern, but not flashy
- dense enough for real work, but never crowded

The interface should feel closer to a serious productivity workspace than to a marketplace, admin panel, or marketing site. It should have the compositional logic of Linear, Cursor, and Claude, but with softer spacing and less visual weight.

The emotional target is:
- focus
- clarity
- control
- calm confidence

## 2. Color Palette & Roles

The palette is intentionally restrained. One primary accent, a neutral surface system, and semantic status colors.

### Core Neutrals

- **Warm Cloud (#F7F8FC)** - main app background; the page should feel softly lit rather than stark white
- **Porcelain (#FFFFFF)** - primary surface for cards, panels, and drawers
- **Mist Blue (#EEF2FF)** - secondary surface tint for sidebar, selected states, and inset blocks
- **Soft Line (#D7DDEF)** - borders, dividers, and subtle panel outlines
- **Charcoal Ink (#111827)** - primary text, titles, and core labels
- **Slate Mist (#667085)** - secondary text, metadata, and helper copy

### Primary Accent

- **Indigo Core (#4F46E5)** - primary actions, selected navigation states, active tabs, and key links
- **Indigo Deep (#3730A3)** - hover / pressed states for the primary accent

### Semantic Status Colors

- **Success Green (#16A34A)** - contacted, confirmed fit, positive evidence, match confidence
- **Warning Amber (#D97706)** - cautionary notes, partial evidence, lower-confidence signals
- **Soft Red (#DC2626)** - exclusion, bounce, invalid route, or clear mismatch

### Usage Rules

- Keep the UI mostly neutral.
- Use indigo sparingly so it feels deliberate and premium.
- Avoid rainbow UI. Do not assign different bright colors to every category.
- Semantic colors should communicate status, not decoration.

## 3. Typography Rules

Typography should feel crisp, modern, and highly readable.

### Hierarchy

- Use a strong but not oversized page title.
- Use clear section headings.
- Use compact metadata and helper text.
- Keep long body copy short and scannable.

### Voice

- Titles: bold, clean, confident
- Supporting labels: medium weight or regular
- Metadata: small, high-contrast, quiet

### Behavior

- Avoid overly condensed text.
- Avoid decorative type styling.
- Use consistent line-height and generous spacing so the interface breathes.
- The layout should feel readable at a glance, even when dense with data.

## 4. Geometry, Shape, and Depth

The geometry should be softly rounded, not pill-heavy and not sharp.

### Rounding

- Cards: 16px to 20px radius
- Buttons: 12px to 16px radius
- Pills / chips: pill-shaped or near-pill
- Panels and drawers: soft rounded containers with consistent edges

### Depth

- Shadows should be whisper-soft and diffused
- Prefer border + surface contrast over heavy drop shadows
- Use elevation sparingly
- Panels should feel layered, not floating dramatically

### Borders

- Thin, soft borders are preferred
- Borders should separate information without making the UI feel boxed-in
- Dividers should be quiet and structural, not dominant

## 5. Layout Principles

The product should use a calm workspace layout with clear zones:

- thin left sidebar
- top utility bar
- central results area
- right-side detail panel

### Layout Rules

- Keep the sidebar narrow and quiet
- Keep the top bar lightweight
- Use tabs for Jobs / Companies
- Show results as readable cards or clean list items
- Keep the detail panel focused on selected-item context and actions
- Preserve whitespace around major sections

### Density

- The interface can be information-dense, but it must not feel crowded
- Prefer fewer, clearer boxes over many nested containers
- Use whitespace as a navigation tool
- Each screen should feel like a composed workspace, not a dashboard collage

## 6. Canonical Screen Structure

### Top Bar

The top bar should contain:
- CV status
- active city selector
- Run action
- search / filter access where relevant

The Run action is the main primary action and should stand out clearly.

### Sidebar

The sidebar is a quiet rail, not the hero of the screen.

It should contain:
- Jobs
- Companies
- Drafts
- Runs
- Settings

The selected item should have a soft indigo-tinted background and stronger text weight.

### Main Content

The center pane should default to a tabbed list of results.

Jobs and Companies are separate tracks:
- Jobs are for applying
- Companies are for cold email

They should never visually collapse into one confusing list.

### Detail Panel

When an item is selected, the right panel should show:
- title / company
- location or contact route
- why it surfaced
- source evidence
- status actions
- draft generation actions

The detail panel should feel light, clear, and trustworthy.

## 7. Component Styling

### Buttons

- Primary buttons: indigo fill, white text, moderate weight
- Secondary buttons: neutral surface with border
- Ghost actions: quiet and understated
- Buttons should be clearly clickable without shouting

### Cards

- White or near-white surfaces
- Soft borders
- Gentle elevation or none
- Rounded corners
- Clear internal hierarchy

### Inputs

- Clean, understated input fields
- Soft borders and calm placeholder text
- No aggressive outlines
- Search and select controls should blend into the workspace

### Chips / Pills

- Use for status, tags, city labels, and metadata
- Keep them compact and legible
- Use color lightly

## 8. Jobs Vs Companies

Jobs and companies are two distinct products inside the same app.

### Jobs

Jobs should emphasize:
- role title
- company
- location
- match score
- fit reason
- apply link
- cover-letter prompt action

### Companies

Companies should emphasize:
- company name
- website
- contact route
- company signal
- fit reason
- cold-email prompt action

The two views should feel related, but not identical.

## 9. Drafting Behavior

Draft generation is explicit and item-based.

- Job item -> generate cover letter prompt
- Company item -> generate cold email prompt

Draft actions should live inside the selected item detail panel.

They should:
- be copyable
- be editable
- use the CV as grounding context
- use the selected item metadata
- never auto-send

## 10. Loading, Empty, and Trust States

### Empty State

Before a run, the app should feel calm and clear:
- upload or point to CV
- choose a city
- click Run

### Loading State

During a run, the app should feel active and trustworthy:
- show buffering / progress
- show current source or stage
- show live counts
- avoid dead spinner-only states

### Trust State

After parsing the CV, show a profile summary before scoring starts.

This summary should explain:
- what the app thinks the user’s positioning is
- what roles are a fit
- what should be excluded
- why the scoring makes sense

## 11. What Not To Do

Do not make the app feel like:
- a crowded dashboard
- a generic ATS
- a marketplace
- a spreadsheet clone
- an overdesigned glassmorphism experiment
- a loud consumer app
- a terminal UI in disguise

## 12. Canonical Direction Summary

If a future screen is uncertain, optimize for:

1. calm clarity
2. airy spacing
3. soft geometry
4. restrained indigo accent
5. strong information hierarchy
6. separate jobs and companies views
7. visible CV grounding
8. item-based draft generation
9. lightweight sidebar + top utility bar + central results + detail pane
10. workspace energy over dashboard energy

This is the canonical design language for Job Sniper.
