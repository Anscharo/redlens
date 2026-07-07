import type { AtlasNode, HitLabel } from "../types";

// Provenance clues rendered in the search-result gutter.
//   - Agent nodes (scope 6) live at A.6.1.1.<n> (Prime Agents: Skybase, Grove, …)
//     and A.6.1.2.<n> (Executor Agents: Ozone, Core Council …); everything
//     beneath one belongs to that agent.
//   - Scopes are the two-segment nodes A.1 … A.6; their title is the scope name.
//   - ICDs are titled "<Name> Instance Configuration Document" (the "… Location"
//     pointer stubs end in "Location", so the end-anchor excludes them).
//
// fragile: doc_no prefix — A.6.1.1/A.6.1.2 are editorial paths, not spec-defined
// structural suffixes, so an Agents-scope renumber (cf. PR #235) silently drops
// agent labels. Mirrors build-time isPrimeAgent/isExecutorAgent in
// scripts/lib/graph-patterns.mjs; keep the two in sync until migrated to
// parent_of-edge ancestry.
const AGENT_DOCNO_RE = /^A\.6\.1\.[12]\.\d+$/;
const SCOPE_DOCNO_RE = /^[A-Za-z]\.\d+$/;
const ICD_TITLE_RE = /^(.+?)\s+Instance Configuration Document$/i;
// Executor Agent titles carry an "Operational Executor Agent " prefix that is
// redundant next to the AGENT tag; strip it to the semantic short name. Core
// Council titles keep their number suffix (it is their identity) and don't
// match this prefix, so they pass through unchanged.
const EXEC_PREFIX_RE = /^Operational Executor Agent\s+/i;

// Self + ancestors, reconstructed from doc_no prefixes rather than parentId.
// The heading-depth cap (6) makes parentId unreliable for deep nodes, but ICDs
// nest far deeper than that (e.g. A.6.1.1.3.2.5.2.3.1), so prefix lookup via
// byDocNo is the reliable way to walk the chain.
export function computeLabels(doc: AtlasNode, byDocNo: Map<string, AtlasNode>): HitLabel[] {
  const chain: AtlasNode[] = [doc];
  const parts = doc.doc_no.split(".");
  for (let i = parts.length - 1; i >= 1; i--) {
    const anc = byDocNo.get(parts.slice(0, i).join("."));
    if (anc && anc.id !== doc.id) chain.push(anc);
  }

  const labels: HitLabel[] = [];
  const agent = chain.find((n) => AGENT_DOCNO_RE.test(n.doc_no));
  if (agent) {
    labels.push({ kind: "agent", text: agent.title.replace(EXEC_PREFIX_RE, "").trim() });
  } else {
    const scope = chain.find((n) => SCOPE_DOCNO_RE.test(n.doc_no));
    if (scope) labels.push({ kind: "scope", text: scope.title });
  }

  const icd = chain.find((n) => ICD_TITLE_RE.test(n.title));
  if (icd) {
    const name = icd.title.match(ICD_TITLE_RE)?.[1].trim();
    if (name) labels.push({ kind: "icd", text: name });
  }

  return labels;
}
