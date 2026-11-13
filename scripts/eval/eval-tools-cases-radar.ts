// Tool-choice cases asked from Radar pages: the index, an actor's Info page
// and each Prime subpage in src/lib/radarPages.ts. SYNTHETIC questions. Each
// leans on "this" or "here", so the page context has to carry the subject.
// The settlements subpage is `msc-page` in eval-tools-cases.ts.
import type { ToolCase } from "./eval-tools-score.ts";

const ENTITY = ["atlas_entity", "atlas_query", "atlas_edges", "atlas_traverse"];
const CHAIN = ["redline_onchain", "redline_liquidity_changes"];
const HISTORY_PARAMS = ["entity", "since", "until", "recent_commits", "change_type"];

export const RADAR_CASES: ToolCase[] = [
  { id: "radar-index-matrix", category: "radar-page", q: "Which of these Primes have activated the fewest primitives?", pageContext: { path: "/radar" }, acceptFirst: ["atlas_report_primitive_matrix"], note: "The Radar index is the primitive activation matrix." },
  { id: "radar-info-what", category: "radar-page", q: "What is this, and who operates it?", pageContext: { path: "/radar/osero", actorSlug: "osero" }, acceptFirst: [...ENTITY, "atlas_search"], allowAtlasQueryParams: ["entity", "edge_types", "direction"], note: "A search is only right when it names the actor; read the arguments." },
  { id: "radar-info-nonprime", category: "radar-page", q: "What is this party responsible for?", pageContext: { path: "/radar/soter-labs", actorSlug: "soter-labs" }, acceptFirst: [...ENTITY, "atlas_report_govops_responsibilities"], allowAtlasQueryParams: ["entity", "edge_types", "direction"], note: "An actor that is not a Prime has one page." },
  { id: "radar-info-pau-roles", category: "radar-page", q: "Walk me through this page. I'd like to understand the Diamond PAU roles.", pageContext: { path: "/radar/osero", actorSlug: "osero" }, acceptFirst: [...ENTITY, "atlas_search", ...CHAIN], acceptAny: CHAIN, allowAtlasQueryParams: ["entity", "edge_types", "direction"], note: "Asked from the Info page, not the Liquidity Layer subpage. Who holds a role is a chain reading; an answer from atlas text alone misses it." },
  { id: "radar-primitives-list", category: "radar-page", q: "Which primitives are active here, and which have instances?", pageContext: { path: "/radar/grove/primitives", actorSlug: "grove" }, acceptFirst: [...ENTITY, "atlas_report_primitive_matrix", "atlas_entities"], allowAtlasQueryParams: ["entity", "edge_types", "direction", "via_entity_type"], note: "" },
  { id: "radar-primitives-chain", category: "radar-page", q: "Which values on these cards disagree with the chain?", pageContext: { path: "/radar/spark/primitives", actorSlug: "spark" }, acceptFirst: ["redline_onchain"], note: "The instance cards' check marks are the atlas-vs-contract facts." },
  { id: "radar-history-recent", category: "radar-page", q: "What changed here in the last two months?", pageContext: { path: "/radar/grove/history", actorSlug: "grove" }, acceptFirst: ["atlas_recent_changes", "atlas_query"], allowAtlasQueryParams: HISTORY_PARAMS, note: "Atlas document history scoped to the actor, not chain changes." },
  { id: "radar-pau-roles", category: "radar-page", q: "Who holds which role here?", pageContext: { path: "/radar/osero/pau", actorSlug: "osero" }, acceptFirst: ["redline_onchain"], note: "" },
  { id: "radar-pau-spell", category: "radar-page", q: "Which spell last changed these limits?", pageContext: { path: "/radar/spark/pau", actorSlug: "spark" }, acceptFirst: ["redline_liquidity_changes"], note: "" },
];
