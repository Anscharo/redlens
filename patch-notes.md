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
  - One bullet per user-visible change worth telling users about. Skip small
    changes that don't matter much, and fold minor fixes/polish into the
    feature bullet they belong to. Internal work never gets a bullet:
    refactors, audits, rating corrections, accuracy passes, or fixes to a
    feature announced in the same block.
  - Keep each bullet minimally descriptive: one short sentence. If it needs
    more than one "—" clause or starts enumerating sub-changes, it's too
    detailed — the fuller story belongs in the PR description, not here.
  - Hard limit: 10 bullets per date block (enforced by the validator).
  - APPEND ONLY: never rewrite, merge, or delete bullets from earlier dates or
    earlier PRs. New bullets go under today's date at the top; everything below
    stays untouched.
  - Update this file in the same PR as the change it describes.
  - Mirror the new bullets into that PR's description too — add a "Patch notes"
    section listing them verbatim, alongside the fuller technical description
    that's already there.

  Only the 10 most recent bullets across all dates are shown on the homepage —
  a bloated date block hides every earlier date entirely, which is why the
  validator (pnpm check:patch-notes) rejects a block with more than 10.
-->

## 2026-08-11
- Fixed long-open tabs getting stuck on an outdated version of the app instead of picking up new releases
- Added keyboard and mouse hints in the bottom-left corner, showing what the arrow keys and shift-click do wherever you are
- Added X Layer support, so addresses on X Layer now link to their own block explorer instead of Etherscan
- Added private Atlas previews — preview a private fork you have GitHub access to by signing in with GitHub
- Atlas PR previews now mark documents removed by a PR, and no longer miss changes in files too large for GitHub to send a diff for

## 2026-08-06
- Added a feedback button to the top bar for reporting bugs
- Hovering an on-chain address now shows its name and any token balances it holds
- Added an On-Chain Addresses report listing every address in Atlas, it meta data and balances. 
- Added Unichain, Plasma, Monad and Plume support, so addresses on those chains now link to their own block explorer instead of Etherscan
- Fixed addresses shown or linked under the wrong chain, including entity pages that followed whichever chain the entity's own name mentioned

## 2026-08-05
- Added a Modification Frequency report showing semantic edit stats by time, type, and section

## 2026-08-04
- Refreshed on-chain contract values automatically each week
- Added Robinhood Chain support — its addresses now resolve contract names and link to the Robinhood Chain explorer instead of Etherscan
- Fixed the chat assistant's message box staying disabled after a rate limit, and added clearer notices when a request fails or the shared usage pool runs out


## 2026-08-03
- Recovered pre-migration history for 1,005 documents that previously showed nothing before the Atlas moved to Markdown
- Added a note saying when a document's history before the markdown migration couldn't be traced
- Improved keyboard navigation and loading reliability in the reader and sidebar
- Fixed search issues with scroll position, excluded terms, and quoted phrases
- Fixed history and radar to show structural and renumbering changes, recover from temporary errors, and link addresses to the correct networks

## 2026-07-31
- Reader documents now start collapsed and open one level at a time
- Shift-click a sidebar chevron (now to right of doc number) to unfold three levels at once, or to fold a whole open branch back in
- Drag the top edge of the split view to resize it, up to 60% of the reader — it now defaults to the size of the document shown, capped at 50%
- Expanded the provenance page with current data sources and explanations of reconstructed and pre-git history

## 2026-07-30
- Enlarged the text in history diffs and set prose lines in the body typeface, keeping document fields and code blocks in monospace
- Fixed pull request links not opening on reconstructed history entries

## 2026-07-29
- Added a reader control to expand, collapse, or hide a whole section and everything nested beneath it
- Redesigned the history tab as a timeline: each change is a node reading as a unit — date and pull request first, then the title and the type of edit — with preview changes shown as a not-yet-cemented break in the line
- Opened the document panel on the History tab by default

## 2026-07-27
- Added an Atlas CrossView report with a visual chunk map of the Atlas, weight bars, a concept catalog with live re-computed data blocks and CSV export, a glossary of defined terms, and CSV export of the chunk breakdown
- The chatbot can now answer cross-cutting questions from the concept censuses, like how many registries are empty or which document types are unused

## 2026-07-24
- Fixed sign-in failing when the site is opened on an alternate domain: visitors are now redirected to the canonical address

## 2026-07-23
- Made history diffs easier to read: heavily rewritten sentences and paragraphs now show as clean before/after blocks instead of interleaved word-by-word changes

## 2026-07-22
- Shared links now unfurl with a generated preview card — documents, radar actors, reports, the connect page, and previews each get their own — on Twitter, Slack, Discord, and other platforms
- Linked the preview Changed only filter in the URL
- Added document selection and saved collections: check documents in the reader or in search results, filter the tree to just your selection, save it as a named collection when signed in, and share a collection by link
- Added a cousin documents section to the annotations panel, linking each Prime Agent document to its equivalent under the other Prime Agents
- Added an agent pill beside the document in the reader, showing which Prime or Executor Agent it belongs to
- Every report's CSV download now includes each referenced document's UUID and a direct Atlas link
- Facilitator, GovOps, and OEA Task Assessment CSV exports no longer merge duty copies into one row — each is listed separately

## 2026-07-20
- MCP now serves reports directly covering Facilitator and GovOps responsibilities, integrator rewards, and Active Data

## 2026-07-15
- On-chain addresses in the Risk Rules report's rule quotes now link to their block explorers
- Reports now offer a "Download full report" button that always exports the complete dataset, alongside a "Download filtered report" button that appears only while a search or filter is active

## 2026-07-13
- Fixed the GovOps and Facilitator reports merging same-titled duties that actually differ between Prime Agents — each variant now keeps its own row with the right agents, and rows that do merge identical per-agent copies now link every copy
- Fixed "failed to render" errors after a new version is deployed — the app now shows a refresh prompt to load the update
- Added per-report search: the header box filters the open report's rows, with the report name in the pill and the same broad/phrase/strict buttons as the Atlas search
- Risk Rules now lists every Prime Agent's copy of a replicated rule as its own row instead of one combined entry
- Fixed the Connect page's tool list to always match the live MCP server

## 2026-07-10
- Added a Download CSV button to every report
- Made the Risk Rules report's source-paragraph preview render document links as clickable links
- Fixed several reader and search glitches, including report filters clearing on expand and the results list jumping on "load more"

## 2026-07-09
- Fixed a range of reliability and data-accuracy issues across search, the reader, and reports

## 2026-07-08
- Added an Updates page with the full improvement history, linked from the homepage

## 2026-07-07
- Added an OEA Task Assessment report rating every Operational Executor Agent task for precision and incentives
- Added a Risk Rules Assessment report scoring the atlas's peg-maintenance, allocation-risk, and smart-contract-security rules
- Rebuilt the Facilitator Responsibilities report on the GovOps duty detection — 310 rows, up from ~48, with facilitator-org filters
- Added a category filter to the GovOps and Facilitator responsibility reports
- Reworked the Risk Rules report into one flat table with a multi-select risk-type filter and a linked rubric page
- Grouped the reports index into OEA Reports and General Reports sections
- Added Atlas history from before the 2025 markdown migration, plus pre-git origins back to MIP sources and the Atlas v2 genesis snapshot


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
