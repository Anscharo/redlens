<!--
  Patch notes — the public "Recent improvements" log on the homepage.

  Authoring contract:
  - Newest date block first (top of file).
  - Each date is a `## YYYY-MM-DD` heading.
  - Each line under a date is one improvement: a single plain-language
    sentence, simpler in tone than a commit message.
  - Update this file in the same PR as the change it describes.

  Only the 10 most recent bullets across all dates are shown.
-->

## 2026-07-01
- Added a Connect page with instructions for hooking an AI assistant up to the atlas over MCP
- Added a "Using it" section to the Connect page with example questions to ask an MCP-connected assistant
- Improved the Atlas MCP tools: graph traversal now reports hop distance and the connecting relationship, and entity lookups are paginated and filterable
- Tightened Atlas search ranking so weakly-related results no longer crowd out the best matches

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
