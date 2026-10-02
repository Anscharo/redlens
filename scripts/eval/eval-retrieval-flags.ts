// Command-line flags for eval-retrieval.ts. Importing this module parses and
// validates them, so a bad flag stops the run before any data loads. The header of
// eval-retrieval.ts documents what each flag does.
import path from "node:path";
import { config } from "../../src/server/config.ts";
import type { GroupPolicy } from "../../src/server/retrieval/embed-units.ts";
import type { Reranker } from "./eval-rerankers.ts";

export const ROOT = path.resolve(import.meta.dir, "../..");
export const argv = process.argv.slice(2);
export const flag = (name: string) => argv.flatMap((a, i) => (a === `--${name}` && argv[i + 1] ? [argv[i + 1]] : []));
export const listFlag = (name: string, dflt: string[]) => flag(name)[0]?.split(",").map((x) => x.trim()).filter(Boolean) ?? dflt;
const die = (message: string): never => {
  console.error(message);
  process.exit(1);
};

export const POLICIES = (flag("policies")[0]?.split(",") ?? ["one_to_one", "icd_params", "breadcrumbs", "directory_direct", "hub_stubs"]) as GroupPolicy[];
export const CAP = flag("cap")[0] ? Number(flag("cap")[0]) : undefined;
export const CAPS = (flag("caps")[0]?.split(",") ?? []).map(Number).filter((n) => Number.isFinite(n));
export const BACKEND = (flag("backend")[0] ?? (config.openrouterApiKey ? "openrouter" : "tfidf")) as "tfidf" | "openrouter" | "ternlight" | "ollama";
if (!["tfidf", "openrouter", "ternlight", "ollama"].includes(BACKEND)) {
  die(`unknown --backend "${BACKEND}"; expected tfidf, openrouter, ternlight or ollama`);
}
// Embedders that run on this machine. See the header: they compare arms, they do
// not stand in for the production model.
export const LOCAL = BACKEND === "ternlight" || BACKEND === "ollama";
export const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
export const MODELS =
  flag("models")[0]?.split(",") ?? (BACKEND === "ternlight" ? ["ternlight"] : BACKEND === "ollama" ? [] : [config.embedModel]);
if (MODELS.length === 0) die("--backend ollama needs --models <name>, an embedding model that `ollama list` shows.");
// Some local models want a prefix on the DOCUMENT side too (nomic: "search_document: ").
// Qwen3 and ternlight take documents raw.
export const DOC_PREFIX = flag("doc-prefix")[0] ?? "";
export const RERANK = (flag("rerank")[0] ?? "none") as Reranker;
// jev / qwen3 rerank the FINAL leaf list (what the shipped path returns for k = N),
// not the anchor pool bm25 works on. N is the reranker's ceiling: recall@N of the
// list is printed beside every arm.
export const LEAF_RERANK = RERANK !== "none" && RERANK !== "bm25";
export const RERANK_N = Number(flag("rerank-pool")[0] ?? 30);
export const COLLAPSE = argv.includes("--collapse");
export const HYBRID = argv.includes("--hybrid");
export const REUSE_DB = argv.includes("--reuse-db");
export const CRUMB_DEPTH = flag("crumb-depth")[0] ? Number(flag("crumb-depth")[0]) : undefined;
// Sweep breadcrumb selection strategies (comma-separated, see CRUMB_STRATEGIES in
// embed-units.ts). Cheap to sweep: only ~143 units' text depends on the crumb, so
// every extra strategy costs ~143 embeddings and the rest reuse cached vectors.
// No offline proxy predicts the winner: full vs nearest:2 are structurally
// identical (same duplicate count, same same-title separation) yet differ by 11 of
// 40 disambiguation queries, so this has to be run neurally.
export const CRUMB_STRATS = flag("crumb-strategies")[0]?.split(",").map((x) => x.trim()).filter(Boolean) ?? [];
// Query instruction prefix. `embedQuery` applies config.embedQueryPrefix itself
// (EMBED_QUERY_PREFIX), so the flag OVERRIDES that value rather than stacking a
// second prefix on top of it. flag() drops an empty argument, so the bare-query
// arm is `--no-prefix`. PREFIX is what the run actually embedded with, for the report.
const PREFIX_FLAG = flag("prefix")[0];
if (argv.includes("--no-prefix")) config.embedQueryPrefix = "";
else if (PREFIX_FLAG !== undefined) config.embedQueryPrefix = PREFIX_FLAG;
// The configured prefix is Qwen3's instruction. ternlight is symmetric, so it is noise there.
else if (BACKEND === "ternlight") config.embedQueryPrefix = "";
export const PREFIX = config.embedQueryPrefix;
export const SUBSET = flag("subset")[0] ? Number(flag("subset")[0]) : undefined;
// --query-style keywords rewrites every generated query to the shape readers
// actually type (see keywordQuery in eval-retrieval-rank.ts). Every arm sees the same rewrite.
export const QUERY_STYLE = (flag("query-style")[0] ?? "natural") as "natural" | "keywords";
if (QUERY_STYLE !== "natural" && QUERY_STYLE !== "keywords") {
  die(`unknown --query-style "${QUERY_STYLE}"; expected natural or keywords`);
}
export const K = Number(flag("k")[0] ?? 10);
export const RERANK_POOL = 50;

// Briefing arms. `none` is the behaviour without briefings; every other value is
// one arm, and each runs once per --briefing-text value.
export const BRIEFING_ARM_NAMES = ["none", "s1", "s2", "s2docs"] as const;
export const BRIEFING_TEXT_NAMES = ["briefing", "questions", "both"] as const;
export type BriefingArmName = (typeof BRIEFING_ARM_NAMES)[number];
export type BriefingText = (typeof BRIEFING_TEXT_NAMES)[number];
export const BRIEFING_ARMS = listFlag("briefings", ["none"]);
export const BRIEFING_TEXTS = listFlag("briefing-text", ["both"]);
export const BRIEFING_FILE = path.resolve(ROOT, flag("briefing-file")[0] ?? "public/doc-briefings.json");
export const POOL_FLAG = flag("pool")[0];
export const OFFLINE = argv.includes("--offline");
for (const a of BRIEFING_ARMS) {
  if (!(BRIEFING_ARM_NAMES as readonly string[]).includes(a)) {
    die(`unknown --briefings value "${a}"; expected ${BRIEFING_ARM_NAMES.join(", ")}`);
  }
}
for (const t of BRIEFING_TEXTS) {
  if (!(BRIEFING_TEXT_NAMES as readonly string[]).includes(t)) {
    die(`unknown --briefing-text value "${t}"; expected ${BRIEFING_TEXT_NAMES.join(", ")}`);
  }
}
if (POOL_FLAG !== undefined && POOL_FLAG !== "all" && POOL_FLAG !== "covered") {
  die(`unknown --pool value "${POOL_FLAG}"; expected all or covered`);
}
export const NEEDS_BRIEFINGS = BRIEFING_ARMS.some((a) => a !== "none");
// --hybrid is allowed with the per-document arm only: that is the chat's hybrid
// lane (lexical, attributed semantic and briefing lists fused in ONE RRF stage,
// search.ts `rrfMerge`), and the reason the arm is measured here at all. The
// eval's lexical leg is TF-IDF, not MiniSearch, so the number is a proxy for
// the shape of the effect, not production's exact figure.
if (NEEDS_BRIEFINGS && (RERANK !== "none" || (HYBRID && BRIEFING_ARMS.some((a) => a !== "none" && a !== "s2docs")))) {
  die("briefing arms do not support --rerank; --hybrid is supported for s2docs only (the chat's three-way fusion).");
}
if (OFFLINE && BACKEND === "tfidf") die("--offline reads a vector cache; pass --backend openrouter, ternlight or ollama.");
if (OFFLINE && REUSE_DB) die("--offline and --reuse-db conflict: run --reuse-db once to fill the cache, then --offline.");
// Matches search.ts's RESIDUAL_ANCHOR_K, the measured peak (51% at top-20).
export const RESIDUAL_ANCHOR_K = 20;
export const OUT = flag("out")[0] ?? path.join(ROOT, ".cache", "eval-retrieval.json");
