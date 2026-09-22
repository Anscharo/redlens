// Tool-choice eval cases (pnpm eval:tools). SYNTHETIC questions — none is, or
// paraphrases, a stored user message. The mix follows the dev-DB aggregate of
// real first calls (2026-09-22: 169 assistant turns — 27% no tool, atlas_query
// 44% of first calls, then atlas_search, atlas_get, atlas_entities, the history
// tools, ask_external_msc, the report tools; 27% of conversations open on an
// atlas node page, 32% are multi-turn), plus the classes known to go wrong:
// report tools, addresses, completeness, MSC near-misses, export, follow-ups.
//
// Labels follow what system-prompt.ts and the tool descriptions instruct, not
// taste; where both are fine both are accepted, and `note` says why when it is
// not obvious. Doc references go by uuid — `{doc_no:<uuid>}` in `q` and
// `pageNode` are resolved against the served atlas at run time.
import { NO_TOOL, type ToolCase } from "./eval-tools-score.ts";

const LOOKUP = ["atlas_query", "atlas_search"];
// Every lookup-shaped case: a search first, OR — when a fact that carries doc
// uuids fired (glossary, role dossier, entity rows; DOC_FACTS in the scorer) —
// straight to atlas_get on a doc it surfaced. The facts round is already a
// retrieval, and its own note tells the model to use those doc_ids. Relabeled
// 2026-09-22 after the baseline showed gemma doing exactly that on
// lookup-ad-voting / lookup-skylink and answering correctly.
const LOOKUP_RULE = { acceptFirst: LOOKUP, acceptFirstAfterDocFacts: ["atlas_get"] };
const ERS = "1d940c6d-02ce-4c17-8057-cef13c1cc7ad"; // A.1.9 Emergency Response System
const ALIGNED_DELEGATES = "75f0063c-ad70-49e4-b356-9b76097ced7b"; // A.1.6
const CURRENT_ADS = "5f584db8-f8d8-4118-988c-b2bc3f68ceb7"; // A.1.6.1.5.0.6.1 Current Aligned Delegates (Active Data)
const RATE_LIMITS = "8efb0a11-b798-48eb-af19-f65b38f039b5"; // A.2.2.10.1.1.1.2.1.2 Rate Limits
const AD_ANSWER = "Aligned Delegates are recognized governance participants who receive delegated voting power and must vote in line with the Atlas. Their duties, communication requirements and derecognition rules sit in the Aligned Delegates article of the Governance Scope.";
const FREEZER_ANSWER = "The Spark Freezer Multisig is a multisig in Spark's artifact that can freeze Spark's integrations in an emergency. It is operated by named signer organizations.";
const PROCESS_ANSWER = "The atlas defines several processes:\n\n1. Weekly Governance Cycle — weekly executive votes.\n2. Monthly Governance Cycle — monthly polls.\n3. Monthly Settlement Cycle — settlement of prime agent revenue.\n4. Updating Active Data — how Active Data documents are edited.";
const MSC_ANSWER = "The Monthly Settlement Cycle is the atlas-defined process in the Support Scope by which Sky Core settles with each Prime Agent every month: revenue owed to Sky and to the agent is calculated and then paid out.";

export const TOOL_CASES: ToolCase[] = [
  // ── Lookups: the largest real class (atlas_query first) ──────────────────
  { id: "lookup-ers", category: "lookup", q: "What is the Emergency Response System and when can it be invoked?", ...LOOKUP_RULE, note: "Concept lookup; no fact fires." },
  { id: "lookup-ad-voting", category: "lookup", q: "What communication requirements apply to Aligned Delegates when they vote?", ...LOOKUP_RULE, note: "Glossary + role dossier fire; the dossier lists the Aligned Delegate communication doc, so atlas_get on it (LOOKUP_RULE) is the ideal first call." },
  { id: "lookup-surplus-buffer", category: "lookup", q: "How does the Surplus Buffer interact with the Smart Burn Engine?", ...LOOKUP_RULE, note: "Routes strong (\"interact\")." },
  { id: "lookup-grants", category: "lookup", q: "What does an ecosystem entity have to do to apply for a grant?", ...LOOKUP_RULE, note: "" },
  { id: "lookup-ssr", category: "lookup", q: "How is the Sky Savings Rate set?", ...LOOKUP_RULE, note: "" },
  { id: "lookup-two-roles", category: "lookup", q: "Is one person allowed to hold two ecosystem roles at the same time?", ...LOOKUP_RULE, note: "Routes strong (governance-risk)." },
  { id: "lookup-skylink", category: "lookup", q: "How does SkyLink move tokens between chains?", ...LOOKUP_RULE, note: "" },
  { id: "lookup-psm", category: "lookup", q: "What does the atlas say about the peg stability module?", ...LOOKUP_RULE, note: "BORDERLINE: the glossary fact fires with the PSM definition and the model tends to answer from it alone. The facts note allows that when it answers the question; for 'what does the atlas say about X' a one-line definition is a thin answer, so no-tool stays a miss." },

  // ── One known document ────────────────────────────────────────────────────
  { id: "doc-by-number", category: "doc", q: `What does {doc_no:${CURRENT_ADS}} list?`, acceptFirst: ["atlas_get", "atlas_query"], note: "Prompt: a single-document question needs ONE atlas_query or atlas_get; atlas_get takes the doc_no directly." },
  { id: "doc-by-uuid", category: "doc", q: `Summarize document ${RATE_LIMITS}`, acceptFirst: ["atlas_get"], note: "A bare uuid is not searchable text; atlas_get is the only lookup that takes it." },
  { id: "node-summarize", category: "node-page", q: "Summarize this document for me.", pageNode: ERS, acceptFirst: ["atlas_get", "atlas_neighbors"], note: "Page context carries the uuid; reading it (or its children) is the job." },
  { id: "node-siblings", category: "node-page", q: "What else is in this section?", pageNode: ALIGNED_DELEGATES, acceptFirst: ["atlas_neighbors", "atlas_get"], note: "atlas_neighbors whenToUse is exactly this question; atlas_get returns children too." },
  { id: "node-active-data", category: "node-page", q: "Who is responsible for keeping this list up to date?", pageNode: CURRENT_ADS, acceptFirst: ["atlas_report_active_data", "atlas_get", "atlas_neighbors"], note: "Prompt maps 'who maintains this Active Data' to atlas_report_active_data; reading the doc and its controller parent is also grounded." },

  // ── Entities ─────────────────────────────────────────────────────────────
  { id: "entity-keel-instances", category: "entity", q: "What instances does Keel run, and what is each one's status?", acceptFirst: ["atlas_entity", "atlas_entities", "atlas_entity_params"], acceptAny: ["atlas_entity", "atlas_entity_params"], allowAtlasQueryParams: ["entity", "status", "target_type"], note: "Prompt: what an actor HAS (instances, status) comes from atlas_entity/_params, never doc titles; atlas_entities first is its own 'resolve a name' step." },
  { id: "entity-soter", category: "entity", q: "What is Soter Labs responsible for?", acceptFirst: ["atlas_entity", "atlas_entities", "atlas_report_govops_responsibilities"], note: "Soter Labs is the GovOps org: atlas_entity returns its responsibilities; the GovOps report filtered to it also answers." },
  { id: "entity-spark-facilitator", category: "entity", q: "Which facilitator is assigned to Spark?", acceptFirst: ["atlas_entity", "atlas_entities", "atlas_edges", "atlas_traverse", "atlas_query"], allowAtlasQueryParams: ["entity", "edge_types", "via_entity_type", "direction"], note: "Graph relationship; atlas_query's entity/edge_types mode is a legitimate graph call here." },

  // ── Addresses (system-prompt.ts's address guidance) ──────────────────────
  { id: "addr-known", category: "address", q: "What is 0xca5183fb9997046fbd9ba8113139bf5a5af122a0?", acceptFirst: ["atlas_get_address"], note: "Reverse lookup of a known address." },
  { id: "addr-actor", category: "address", q: "What on-chain addresses does Grove control?", acceptFirst: ["atlas_entity", "atlas_entities", "atlas_report_addresses", "atlas_traverse", "atlas_report_multisigs"], acceptAny: ["atlas_entity", "atlas_report_addresses", "atlas_traverse", "atlas_report_multisigs"], note: "Prompt: atlas_query returns documents, never addresses — atlas_entity's addresses block, the address/multisig reports, or atlas_traverse." },
  { id: "addr-multisig", category: "address", q: "What is the address of the Spark Freezer Multisig, and on which chain?", acceptFirst: ["atlas_entity", "atlas_entities", "atlas_report_multisigs", "atlas_report_addresses"], acceptAny: ["atlas_entity", "atlas_report_multisigs", "atlas_report_addresses"], note: "Same address rule; the multisig report carries chain + address per row." },
  { id: "addr-inventory", category: "address", q: "List every token contract address the atlas mentions.", acceptFirst: ["atlas_report_addresses"], note: "Full inventory by type = atlas_report_addresses." },

  // ── Curated reports, asked directly ──────────────────────────────────────
  { id: "rpt-multisigs", category: "report", q: "Give me every multisig with its signing threshold and signer organizations.", acceptFirst: ["atlas_report_multisigs"], note: "" },
  { id: "rpt-primitive-matrix", category: "report", q: "Which primitives has each Prime Agent activated, and which are dormant?", acceptFirst: ["atlas_report_primitive_matrix"], note: "" },
  { id: "rpt-facilitator", category: "report", q: "What is an Operational Facilitator responsible for?", acceptFirst: ["atlas_report_facilitator_responsibilities"], note: "Glossary + role dossier fire, but the prompt maps this exact question to the report; the dossier is not the duty list." },
  { id: "rpt-govops", category: "report", q: "What is Operational GovOps responsible for?", acceptFirst: ["atlas_report_govops_responsibilities"], note: "As rpt-facilitator." },
  { id: "rpt-rewards", category: "report", q: "Which integrators receive Distribution Rewards from Spark, and at which payout addresses?", acceptFirst: ["atlas_report_rewards", "atlas_entity_params"], note: "Rewards report is the rollup; atlas_entity_params with a reward type_hint returns the same instance params." },
  { id: "rpt-active-data", category: "report", q: "Who maintains each Active Data document, and who approves changes to it?", acceptFirst: ["atlas_report_active_data"], note: "" },
  { id: "rpt-stale", category: "report", q: "Which dated deadlines in the atlas have already passed?", acceptFirst: ["atlas_report_stale_dates"], note: "" },
  { id: "rpt-processes", category: "report", q: "What governance processes does the atlas define?", acceptFirst: ["atlas_report_processes"], note: "The curated process inventory is the direct answer." },
  { id: "rpt-oea", category: "report", q: "How precisely are the Operational Executor Agent's tasks defined?", acceptFirst: ["atlas_report_oea_assessment"], note: "" },
  { id: "rpt-risk", category: "report", q: "Which risk rules have weak penalties?", acceptFirst: ["atlas_report_risk_rules"], note: "" },

  // ── From a report page (the prompt says call that page's tool) ───────────
  { id: "page-oea", category: "report-page", q: "Which tasks here are rated weakest on incentives?", pageContext: { path: "/reports/oea-assessment", reportName: "OEA Task Assessment", reportTool: "atlas_report_oea_assessment" }, acceptFirst: ["atlas_report_oea_assessment"], note: "" },
  { id: "page-addresses", category: "report-page", q: "Which of these addresses hold USDS?", pageContext: { path: "/reports/onchain-addresses", reportName: "On-Chain Addresses", reportTool: "atlas_report_addresses", reportFilter: "grove" }, acceptFirst: ["atlas_report_addresses"], note: "Filtered page: the prompt asks for the filter to be passed along." },
  { id: "page-govops", category: "report-page", q: "Summarize this report.", pageContext: { path: "/reports/gov-ops-responsibilities", reportName: "Operational GovOps Responsibilities", reportTool: "atlas_report_govops_responsibilities" }, acceptFirst: ["atlas_report_govops_responsibilities"], note: "" },

  // ── History ──────────────────────────────────────────────────────────────
  { id: "hist-recent", category: "history", q: "What changed in the atlas recently?", acceptFirst: ["atlas_recent_changes", "atlas_history_stats", "atlas_query"], allowAtlasQueryParams: ["recent_commits", "since", "until", "change_type"], note: "atlas_query's own schema advertises recent_commits for 'recently'." },
  { id: "hist-trend", category: "history", q: "How has the pace of atlas edits changed quarter by quarter?", acceptFirst: ["atlas_history_stats"], note: "" },
  { id: "hist-between", category: "history", q: "Which documents changed between atlas commits 8cba815 and a2e7af9?", acceptFirst: ["atlas_changed_between"], note: "Two real commits in atlas_history." },
  { id: "hist-pr", category: "history", q: "What did atlas PR #292 change?", acceptFirst: ["atlas_pr"], note: "" },
  { id: "hist-doc-why", category: "history", q: `Why was {doc_no:${ALIGNED_DELEGATES}} last changed?`, acceptFirst: ["atlas_history"], note: "One named doc's change log." },
  { id: "hist-first-seen", category: "history", q: `Since when has {doc_no:${ERS}} existed in the atlas?`, acceptFirst: ["atlas_first_seen", "atlas_history"], note: "" },

  // ── Parameters ───────────────────────────────────────────────────────────
  { id: "param-buyback", category: "param", q: "What is Spark's enhanced buyback threshold?", acceptFirst: ["atlas_params", "atlas_entity_params", "atlas_query"], allowAtlasQueryParams: ["entity", "include_params"], note: "atlas_params whenToUse fits; the prompt's 'START HERE' makes atlas_query acceptable too." },
  { id: "param-liquidation", category: "param", q: "Look up the configured liquidation thresholds for Spark's lending markets.", acceptFirst: ["atlas_params", "atlas_entity_params", "atlas_query", "atlas_entities"], acceptAny: ["atlas_params", "atlas_entity_params"], allowAtlasQueryParams: ["entity", "include_params"], note: "atlas_entities first resolves 'Spark' to a slug, which is what its own description says to do before atlas_entity_params; the values must then come from a params tool (acceptAny). Relabeled after the 2026-09-22 baseline." },

  // ── Completeness: superlative / exhaustive ───────────────────────────────
  { id: "class-oldest", category: "class", q: "What is the oldest Rate Limit document in the atlas?", acceptFirst: ["atlas_first_seen", "atlas_filter"], acceptAny: ["atlas_first_seen"], note: "Prompt: oldest first-seen over a named class = class-mode atlas_first_seen; ranked search is not a census." },
  { id: "class-count", category: "class", q: "How many documents are titled 'Rate Limits'?", acceptFirst: ["atlas_filter", "atlas_first_seen"], note: "Exact-title class count." },
  { id: "class-scenarios", category: "class", q: "List every Scenario document in the atlas.", acceptFirst: ["atlas_filter"], note: "Exhaustive listing by type = atlas_filter." },

  // ── Monthly Settlement Cycle figures (not atlas) and near-misses ─────────
  { id: "msc-venues", category: "msc", q: "Which venues brought in the most revenue in the latest settlement cycle?", acceptFirst: ["ask_external_msc"], note: "A ranking over MSC results with no currency sign — the prompt's own example." },
  { id: "msc-spark-month", category: "msc", q: "What was Spark's prime agent revenue in July 2026?", acceptFirst: ["ask_external_msc"], note: "" },
  { id: "msc-page", category: "msc", q: "Explain these numbers.", pageContext: { path: "/radar/spark/settlements", actorSlug: "spark", mscMonth: "2026-08" }, acceptFirst: ["ask_external_msc"], note: "The page line itself names the call. A no-tool answer here is a real failure (baseline: 2 of 3 routed runs), not a label question." },
  { id: "msc-near-process", category: "msc-near", q: "What is the Monthly Settlement Cycle and who executes each step?", acceptFirst: [...LOOKUP, "atlas_get", "atlas_report_processes"], forbid: ["ask_external_msc"], note: "Process question = atlas text (the prompt's reading (1))." },
  { id: "msc-near-netrev", category: "msc-near", q: "How does the atlas define Sky's Net Revenue?", acceptFirst: [...LOOKUP, "atlas_get", NO_TOOL], forbid: ["ask_external_msc"], note: "Definition question; the glossary fact fires and the prompt itself names the defining doc, so answering from it is fine." },

  // ── Drafting ─────────────────────────────────────────────────────────────
  { id: "draft-email", category: "draft", q: "Draft an email to a new Prime Agent team explaining what the Weekly Governance Cycle requires of them.", acceptFirst: [...LOOKUP, "atlas_get"], forbid: ["export_findings"], note: "Drafts carry citations, so they need a retrieval; export only when asked." },
  { id: "draft-followup", category: "draft", q: "Turn that into a short forum reply welcoming a new delegate.", history: [{ role: "user", content: "What are Aligned Delegates?" }, { role: "assistant", content: AD_ANSWER }], acceptFirst: [...LOOKUP, "atlas_get", NO_TOOL], forbid: ["export_findings"], note: "Re-retrieving for citations or writing from the prior answer are both defensible; exporting is not." },

  // ── Export ───────────────────────────────────────────────────────────────
  { id: "export-md", category: "export", q: "Export that as a markdown file.", history: [{ role: "user", content: "What governance processes does the atlas define?" }, { role: "assistant", content: PROCESS_ANSWER }], acceptFirst: ["export_findings"], note: "" },
  { id: "export-csv", category: "export", q: "Can I get that list as a CSV?", history: [{ role: "user", content: "What governance processes does the atlas define?" }, { role: "assistant", content: PROCESS_ANSWER }], acceptFirst: ["export_findings", "atlas_report_processes", ...LOOKUP, "atlas_get"], acceptAny: ["export_findings"], note: "CSV rows need the data: fetching it first (the process report or a lookup) and exporting after is correct, as long as the export happens. Relabeled after the 2026-09-22 baseline." },
  { id: "export-near", category: "app", q: "How do I download a chat answer?", acceptFirst: [], forbid: ["export_findings"], note: "How-to question: the features fact answers it; nothing was asked to be exported." },

  // ── Small talk and the app itself (no tool: facts inject the guide) ──────
  { id: "smalltalk-hi", category: "smalltalk", q: "hi there!", acceptFirst: [], note: "" },
  { id: "smalltalk-thanks", category: "smalltalk", q: "thanks, that's really helpful", history: [{ role: "user", content: "What are Aligned Delegates?" }, { role: "assistant", content: AD_ANSWER }], acceptFirst: [], note: "" },
  { id: "app-what-can", category: "app", q: "What can you help me with?", acceptFirst: [], note: "Features fact fires." },
  { id: "app-history-howto", category: "app", q: "How do I see the edit history of a document in this app?", acceptFirst: [], note: "Features fact fires; a history tool call answers a different question." },

  // ── Schema / censuses ────────────────────────────────────────────────────
  { id: "describe-biggest", category: "describe", q: "Which part of the atlas is the biggest?", acceptFirst: ["atlas_describe"], note: "atlas_describe's stats section answers exactly this." },
  { id: "census-ghost-types", category: "describe", q: "Which document types are defined but never used?", acceptFirst: [NO_TOOL, "atlas_describe"], note: "The census fact fires with the summary; atlas_describe's censuses section has the member list." },

  // ── Follow-ups ───────────────────────────────────────────────────────────
  { id: "fu-threshold", category: "follow-up", q: "What's its signing threshold?", history: [{ role: "user", content: "What is the Spark Freezer Multisig?" }, { role: "assistant", content: FREEZER_ANSWER }], acceptFirst: ["atlas_entity", "atlas_entities", "atlas_report_multisigs", "atlas_entity_params"], note: "Prompt: a multisig's threshold comes from atlas_entity; the multisig report has it per row." },
  { id: "fu-ad-comp", category: "follow-up", q: "How are they compensated?", history: [{ role: "user", content: "What are Aligned Delegates?" }, { role: "assistant", content: AD_ANSWER }], ...LOOKUP_RULE, note: "" },
  { id: "fu-msc-numbers", category: "follow-up", q: "And what were the actual numbers for Grove last month?", history: [{ role: "user", content: "What is the Monthly Settlement Cycle?" }, { role: "assistant", content: MSC_ANSWER }], acceptFirst: ["ask_external_msc"], note: "Turns from the process (atlas) to the published results (not atlas)." },
];
