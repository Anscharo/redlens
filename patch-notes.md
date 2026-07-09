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

## 2026-07-09
- Limited oversized chatbot tool results and marked truncated responses so broad Atlas lookups recover cleanly

## 2026-07-07
- Cleaned up the Risk Rules report — click anywhere on a row to open its reasoning, filter pills show full risk-type names with rule counts and explanatory tooltips, and the mostly-empty status column became an inline badge on the affected rows
- Replaced the Risk Rules report's per-category sections with one flat table that tags each rule with all of its risk types, and made the risk-type filter multi-select with checkboxes
- Linked the rubric hash on the Risk Rules report to a new page showing the full assessment rubric
- Grouped the reports index into OEA Reports and General Reports sections
- Improved assessment report tracking and keyboard access to per-row reasoning
- Fixed the OEA Task Assessment freshness status to account for full-document changes, not only the displayed snippet
- Added a Risk Rules Assessment report — every atlas paragraph that defines a peg-maintenance, allocation-risk, or smart-contract-security rule, scored 1–5 for how precisely it's defined and weak/mid/strong for penalties and incentives, with AI-drafted reasoning and links to the enforcement mechanisms
- Added an OEA Task Assessment report — every task the Operational Executor Agent performs, rated weak/mid/strong for how precisely it's defined and whether it carries incentives or penalties, with AI-drafted per-task reasoning and links to the enforcement mechanisms
- Added a category filter to the GovOps and Facilitator responsibility reports — narrow a report to one duty category (e.g. only Operational duties), combinable with the org/executor/prime pills
- Rebuilt the Facilitator Responsibilities report on the same duty detection as the GovOps report — it now catches every Atlas section tasking a Facilitator (310 rows, up from ~48), with filter pills for facilitator orgs and a new assignments section
- Fixed the GovOps and Facilitator responsibility reports missing duties written as an instance's "Curator:" field, a multisig "controlled by" clause with an extra noun or joint holders, or an "approval of" / "supervision of" phrase
- Fixed the OEA Task Assessment report including Active Data tasks that actually belong to Core GovOps or the Core Facilitator, not the Operational Executor Agent
- Corrected 14 ratings and dropped 6 non-rule paragraphs from the Risk Rules Assessment after a spot-check audit — mostly enforcement ratings that cited a mechanism not reaching the rule's actor; applied 19 additional corrections from a Sonnet-verified re-audit of the inclusion bias, dropping 17 more bare definitions/capabilities and correcting 2 enforcement ratings
- Fixed the GovOps and Facilitator responsibility reports missing a section's second duty when it tasks both the Core and Operational side of the role (e.g. a "Sky Governance path / Independent Governance path" split)
- Fixed the responsibility reports and OEA Task Assessment picking up duties from Needed Research questions, Scenario examples, and rubric-element annotations, which were never real duties
- Reviewed every OEA Task Assessment rating with high stakes (strong precision or a rewarded/penalized incentives rating) and corrected the ones that didn't hold up — wrong enforcement-mechanism citations, a few over- and under-ratings, and a bare process-step preview that read as a real duty when it wasn't

- Added true pre-git Atlas origins for older sections, including MIP sources and the Atlas v2 genesis snapshot
- Added Atlas history from before the 2025 migration to markdown, behind a "View HTML Era Edits" toggle


## 2026-07-03
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
