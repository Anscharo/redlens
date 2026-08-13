// OFFLINE HTML-era history curation model knobs. Read directly from process.env
// here rather than through src/server/config.ts: none of these four have a
// runtime reader anywhere in src/server — every consumer is one of this
// directory's offline scripts (auto-curate-html-history.mjs,
// audit-html-decisions.mjs, build-history-curation.mjs), so config.ts's own
// scope (what the live server reads) shouldn't carry them. (A stale comment in
// src/server/history/history-curate.ts used to suggest curationFrontierModel
// had a runtime reader — it doesn't; that file takes the model as a plain
// `opts.model` parameter and only these offline scripts ever supply
// non-default values.)
//
// These scripts still import src/server/config.ts separately for
// config.openrouterApiKey — this module only narrows where the FOUR curation
// model names themselves are parsed.

// Selector for the auto-curator's pass-2 (LLM∩matcher): proposes a predecessor
// per case; a case LOCKS only when this pick agrees with the matcher, so a
// wrong pick / JSON failure just falls through to the human — never a bad
// lock. Picked by the model bakeoff (scripts/htmlhist/curation-model-bakeoff.mjs):
// mistral-nemo had the best hard-case accuracy (97%) at the lowest cost.
// Decoupled from chatModel so live chat and the curation selector swap
// independently.
export const CURATION_SELECTOR_MODEL = process.env.CURATION_SELECTOR_MODEL ?? "mistralai/mistral-nemo";

// Models for the auto-curator's CLUSTER pass (joint assignment over
// near-identical siblings that share candidates). A subject LOCKS only when
// these DIFFERENT-family models agree AND the pick is globally
// conflict-free — a stronger, more independent signal than LLM∩matcher, since
// the matcher is exactly what fails on these. CSV, ≥2 distinct families.
// Anthropic side is claude-haiku-4.5 (cheap) rather than sonnet: the
// two-family agreement lock is a cross-family CHECK on deepseek's pick, so the
// Anthropic model only needs to be a competent independent voter — haiku
// suffices and the cluster pass is the only place it runs.
export const CURATION_CLUSTER_MODELS = (
  process.env.CURATION_CLUSTER_MODELS ?? "deepseek/deepseek-v4-flash,anthropic/claude-haiku-4.5"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Frontier model the auto-curator escalates UNCERTAIN cases to (pass 3,
// opt-in via --frontier). Pricier than the selector; only the contested
// residual is routed here. deepseek-v4-pro won the bakeoff's frontier slot
// (94% hard-acc, 0 JSON failures).
export const CURATION_FRONTIER_MODEL = process.env.CURATION_FRONTIER_MODEL ?? "deepseek/deepseek-v4-pro";

// Cheap second model the decision audit (audit-html-decisions.mjs) uses to
// independently re-pick each curation predecessor; disagreements with the
// recorded decision are flagged for pass-2 review.
export const CURATION_AUDIT_MODEL = process.env.CURATION_AUDIT_MODEL ?? "google/gemma-4-31b-it";
