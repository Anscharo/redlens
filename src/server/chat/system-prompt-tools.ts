// The Tools section of the chat system prompt. The atlas_report_* entry lists
// every registered report tool with its own promptBlurb, in REPORT_TOOLS
// order, so a new report tool reaches the prompt by registering itself.
import { REPORT_TOOLS } from "../reports/index.ts";

const TOOL_GUIDE = [
  "## Tools",
  "Use these tools — do not answer governance questions from memory:",
  "- `atlas_query` — START HERE for most questions. One call spans search + entity-graph traversal + doc-type filter + history + status + ancestor scope. Prefer one rich call over many narrow ones.",
  "- `atlas_search` — plain lexical/semantic/hybrid search when you only need to find docs by words.",
  "- `atlas_get` — fetch full node(s) by UUID or doc_no (with ancestor chain). Use after a search to read a doc in full.",
  "- `atlas_entities` / `atlas_entity` / `atlas_entity_params` — resolve a name to a slug with `atlas_entities`, then read what an actor ACTUALLY HAS or its configured values (an agent's instances, a multisig's signer count and threshold, an instance's rate or status). `atlas_entity` also returns an `addresses` block: every on-chain address the actor holds plus those held by the entities it is linked to, each with the owner and its provenance doc_nos. A document existing FOR an entity (a scaffold hub) does NOT mean the entity has that thing populated: read the instance's real params/status, never infer it from a doc title.",
  "- `atlas_get_address` — resolve an on-chain address (0x… / base58) to its atlas entity, roles, and chain-state. This is the REVERSE direction only: it takes an address you already have.",
  "- Addresses hang off the entity that HOLDS them, so an actor's own edges expose only its own address, and `atlas_query` returns documents — never addresses. For every address connected to an actor — the multisigs it signs, the instances it runs — call `atlas_entity` and read its `addresses` block, or `atlas_report_multisigs` for every multisig at once, or `atlas_traverse` (which accepts an entity slug and returns address nodes). For the full inventory of every address the atlas mentions (type, owner, cached balances) call `atlas_report_addresses`; for one already-known address prefer `atlas_get_address`. Never answer an address question with an entity name that has no address attached.",
  "- `atlas_filter` — complete class listing by exact `title`, `title_prefix`, type, `doc_no_pattern`, ancestor, or depth. Ranked search is not a census: use this (or class-mode `atlas_first_seen`) for oldest / all / how many.",
  "- `atlas_edges` — enumerate all graph edges of a type or all edges from/to an entity slug; use for exhaustive relationship maps.",
  "- `atlas_history` / `atlas_recent_changes` — what changed, when, and in which PR. Every event carries the changed document's `doc_id`, `doc_no` and `title`, so LINK the document each change is about, exactly as you would any other claim: a change report whose bullets have no links leaves the reader nothing to open. Report what the event RECORDS — a PR title and a commit message say a document changed, never what it now says; if the answer needs the new content, retrieve that document and cite it.",
  "- `atlas_history_stats` — summarize Atlas history by month/quarter; use for trend, timeline, and coverage-window questions.",
];

const REPORT_GUIDE_LEAD = "- `atlas_report_*` — curated, one-call rollups too big to assemble by hand (each documents its own return shape). ";

const TOOL_GUIDE_TAIL = [
  "- `atlas_first_seen` — bulk 'since when' / oldest first-seen, derived from atlas_history. For a named class pass `title` / `type` / … (not ids from search). Use only when the atlas text has no explicit date; cite `first_seen_source` (a PR number, a mip/genesis/html/severed era tag, or a commit) as history-derived, never as an atlas-stated date.",
  "- `atlas_describe` — re-inspect the live schema (types, edge kinds) if you need exact vocabulary for a filter.",
  "- `export_findings` — hand the user a downloadable file. Call it ONLY when the user explicitly asks to export, save, or download what you found: use `format: \"markdown\"` for prose and `format: \"csv\"` (with `columns` + `rows`) for tabular data. Answer the question first; then, if asked, export. After calling it, tell the user their file is downloading.",
  "- `ask_external_msc` — Monthly Settlement Cycle figures (Soter workbooks + Sky Forum permalink). NOT Atlas. Pick view month / series / compare / venues / aggregate / terms. Repeat the disclaimer. Never cite these dollars as Atlas documents. If you then export those figures, the FILE must carry the disclaimer too — it is checked before it downloads.",
];

const BUDGET_RULES = [
  "Superlatives and exhaustive questions (`oldest`, `earliest`, `newest`, `all`, `every`, `how many`) require a **complete class listing** first (`atlas_filter` by `title` / `title_prefix` / `type` / `doc_no_pattern`). `atlas_search` / `atlas_query` `query` are ranked and are not a census. If the listing is `has_more` or `truncated`, you may not claim oldest / first / all — page or narrow until `has_more` is false, or say the set is incomplete. “Among the documents I retrieved” is not an answer to a question about the atlas. For oldest first-seen over a named class, call `atlas_first_seen` with the class filter, not with ids from search.",
  "That budget exists for the other case: when a question asks for a PROPERTY of several things — their addresses, thresholds, statuses, rates, dates — resolve that property for every one you name. A row carrying only a name is not an answer to a question about its address; spend a round fetching the fact, or say plainly that the atlas does not record it. Listing the things and omitting the thing asked for is the one failure worth an extra tool call.",
];

function reportToolsGuide(): string {
  return REPORT_GUIDE_LEAD + REPORT_TOOLS.map((t) => `\`${t.name}\`: ${t.promptBlurb}`).join(" ");
}

export function toolsSection(maxIterations: number): string[] {
  return [
    ...TOOL_GUIDE,
    reportToolsGuide(),
    ...TOOL_GUIDE_TAIL,
    `You may call tools up to ${maxIterations} rounds. A question about a single document usually needs exactly ONE atlas_query (or atlas_get) — once that lookup is in hand, answer. Superlatives and exhaustive questions are the other case: they are not answered from the first search hits.`,
    ...BUDGET_RULES,
  ];
}
