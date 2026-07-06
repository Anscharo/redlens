<!--
  Patch notes — the public "Recent improvements" log on the homepage.

  Authoring contract:
  - Newest date block first (top of file).
  - Each date is a `## YYYY-MM-DD` heading.
  - Each line under a date is one improvement: a single plain-language
    sentence, simpler in tone than a commit message.
  - Keep each bullet a short, plain highlight of WHAT CHANGED. Don't be verbose
    and don't add judgment / marketing language or a "so you can…" rationale
    (avoid "calmer", "easier", "at a glance", "keep your place"). Just state the
    change: "Lightened the reader text", not "Lightened the text for easier
    reading".
  - Update this file in the same PR as the change it describes.
  - Mirror the new bullets into that PR's description too — add a "Patch notes"
    section listing them verbatim, alongside the fuller technical description
    that's already there.

  Only the 10 most recent bullets across all dates are shown.
-->

## 2026-07-06
- Added an OEA Task Assessment report — every task the Operational Executor Agent performs, rated weak/mid/strong for how precisely it's defined and whether it carries incentives or penalties, with AI-drafted per-task reasoning and links to the enforcement mechanisms
- Added a category filter to the GovOps and Facilitator responsibility reports — narrow a report to one duty category (e.g. only Operational duties), combinable with the org/executor/prime pills
- Rebuilt the Facilitator Responsibilities report on the same duty detection as the GovOps report — it now catches every Atlas section tasking a Facilitator (310 rows, up from ~48), with filter pills for facilitator orgs and a new assignments section
- Entity pages and constellations now show the duties the Atlas assigns to Facilitators and Executor Agents, using the same duty detection that powers the GovOps report
- Made the GovOps Responsibilities report catch powers, not just chores — discretionary authority (conservatorship, parameter changes, multisig control) and duties written under the org names Atlas Axis and Soter Labs now appear, and mistaken "GovOps meeting" entries (which belong to the Governance Point) are gone
- Duty rows in the GovOps report now show the exact Atlas sentence that assigns the duty
- The selected section now stays pinned to the top of the reader while you scroll through its subsections
- Improved the expand-all control for sections with large or hidden subsection hierarchies
- Refreshed the reader's look and feel: unified surface, slimmer scrollbars, and a colored rail on selected sections
- Added labels beside each search result showing which scope, agent (e.g. Skybase, Grove), or Instance Configuration Document a hit lives under, so you can place a result at a glance

## 2026-07-01
- Added an Operational GovOps Responsibilities report — every Atlas section that mandates action from a GovOps actor, with per-executor assignments and the Active Data they maintain
- Added a Connect page with instructions for connecting an AI assistant to the atlas over MCP
- Improved the Atlas MCP tools — better search ranking, look up an actor by plain name, and leaner, more reliable responses

## 2026-06-30
- add recent searches feature
- Added an "open atlas prs" tab on the preview page that lists every pull request currently open against next-gen-atlas, so you can preview one without hunting for its number — plus a quick link to the PRs page on GitHub
- The preview loading screen now names what it's preparing (e.g. "Preparing preview Sky Atlas for PR #256…")
- Added a warning marker in preview mode when a branch reassigns a document's identity — a ⚠ flags when a UUID now points to a completely different document, or when a document's content has moved to a new UUID, with details on hover

## 2026-06-26
- Browser tab now shows what you're viewing — atlas doc, report, radar actor, or search query — instead of always "Sky Atlas by Redline"
- Search now finds a document by a partial UUID — paste just the first segment (e.g. a491d7d0) instead of the full id

## 2026-06-25
- Cross-references that linked out to sky-atlas.io now open the section inside Redline Atlas instead


## 2026-06-23
- Fixed addresses on Base and other non-Ethereum chains linking to the wrong block explorer
- Sped up the Active Data report load by fetching edit history in one request instead of one per row

## 2026-06-19
- Added an expand-children toggle to the reader
- Added a "cradle" visual indicator for a section's children

## 2026-06-17
- New [Stale Dates report](/reports/stale-dates)

## 2026-06-16
- Moved history storage into the database
- Removed unneeded legacy code
- Improved how the reader updates when the Atlas changes
- Added a background worker that keeps the Atlas up to date (every 12m)
- Animated scroll when jumping across the Atlas
- Smoother experience when using the tree sidebar

## 2026-06-15
- Added a visual indicator for children of the selected section
- Lightened colors for better visibility
- Added a color depth indicator to section headings
