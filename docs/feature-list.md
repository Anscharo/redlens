
  Product and features

  - [ ] Reader
    - [ ] Selection + Collections —
requires sign-in (GitHub); check documents in the reader or search results, filter the tree to just your selection, save as a named collection, share it by public link
    - [ ] Split View — Shift-Click any doc to open it in a second pane with its children
(low discoverability: the only hint lives inside the pane)
    - [ ] History
        - [ ] Pre-history — HTML-era reconstruction plus pre-git MIP/genesis origins, with provenance disclaimers
      - [ ] Version diffs — heavily rewritten sentences show as before/after blocks instead of word-by-word
    - [ ] Annotations
        - [ ] Glossary - 
      - [ ] Linked docs, cousin docs, mentioned addresses with metadata (chain-correct explorer links), back-references
      - [ ] Agent pill — which Prime or Executor Agent owns the document
    - [ ] Tree sidebar — keyboard navigation, expand-all / expand-children, depth coloring + child cradle, selected section pinned while scrolling
    - [ ] Deep-linkable state + scroll/visit memory
  - [ ] Search — a full query language: broad / phrase / strict / fuzzy;
title: type: in: filters;
-exclude; jump by doc number, 0x address, chainlog id, or full/partial UUID;
/ slash commands; recent searches; result
  context labels (scope / agent / ICD a hit lives under); per-report scoped search
  - [ ] Preview (preview) — plus: open-PRs tab, trust gating for untrusted forks, ⚠ UUID-swap identity warning, Changed-only filter, rollup badge, build-error detail, preview-scoped history
  - [ ] Radar - 
    - [ ] History
    - [ ] Actor dashboards — composite party, responsibilities, primitives, relationships, rewards, invoked instances, on-chain state, contact
    - [ ] Primitive dashboards / activation matrix
    - [ ] Recently-viewed actors
  - [ ] Reports — 8 reports + a rubric page. OEA Assessment and Risk Rules are AI-drafted against a fixed published rubric, human-reviewed, with per-task reasoning. CSV export on every report (full vs filtered, with UUIDs
  + direct atlas links), URL-synced filters
  - [ ] Chat ⚑ —
requires sign-in (GitHub); page-context aware, report-backed tools, answer verification badge, inline sources, tool trace, usage/credits meter, dock or float
  - [ ] MCP — 26 tools:
 atlas_query as the combined search + graph + history entry point,
 atlas_pr,
 atlas_changed_between,
 atlas_first_seen, address lookup, 4 report tools — plus the
/connect page with copy-paste setup
  per client (Claude Code, Claude Desktop, Cursor/Windsurf)
  - [ ] Link unfurl cards — server-rendered preview images per document, radar actor, report, connect page, and preview, on Twitter/Slack/Discord and elsewhere
  - [ ] Always-current atlas — a background worker tracks upstream next-gen-atlas; the app detects a new version and offers a one-click reload. Footer shows the live atlas commit, node count, and chain-state block
  - [ ] Constellations (deprecate?) — route and view still work, but it's absent from the nav and homepage, so it's direct-URL only


* Address references
    * Example: {%preview https://atlas.redline.support/atlas?id=764ec592-5ff7-462c-9617-759914e1077b&view=annotations %}