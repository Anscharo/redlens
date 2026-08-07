// Owner resolution for paramIndex.ts: walks a doc's ancestors (via parentId)
// to find the nearest one that names an owning agent/entity, skipping
// structural/template container titles.
//
// Validated against the real corpus (public/docs.json): the 8 Prime Agent
// subtrees under "List Of Prime Agent Artifacts" (Spark, Grove, Keel,
// Skybase, Obex, Pattern, Osero, Launch Agent 7) sit at a fixed ancestor
// depth, with a templated container ("Omni Documents" or "Sky Primitives")
// directly between the agent and its param docs — e.g. for Keel's "USDS Mint
// Maximum" doc, walking up hits "Sky Primitives" (generic, skipped) then
// "Keel" (real owner). The Risk Capital subtree (A.3.2) has no such
// entity-per-branch structure — its ancestors are all methodology container
// titles ("Instance Financial RRC Implementation", "Required Risk Capital
// Calculation Implementation") which this heuristic correctly skips all the
// way up to Scope, leaving owner=null. That's intentional, not a bug: the
// entity a risk-rating row is *about* (e.g. "Fluid") is the row's own doc
// title, not an ancestor, and stays visible in `context` instead — see
// paramIndex.ts's report notes.
import type { AtlasNode } from "../types";

// Scope/Article/Section are always structural per ATLAS_MARKDOWN_SYNTAX.md's
// document-type vocabulary — never entity names, so skip unconditionally.
const GENERIC_ANCESTOR_TYPES = new Set(["Scope", "Article", "Section"]);
const GENERIC_TITLE_PREFIX_RE = /^List Of /i;
// Trailing generic-category nouns ("Vault Types", "Omni Documents", "Sky
// Primitives", "Agent Artifacts", "Native Vault Engine", "...Implementation")
// name a *kind* of container, not a specific owner.
const GENERIC_TITLE_SUFFIX_RE =
  / (Types|Documents|Primitives|Parameters|Artifacts|Requirements|Implementation|Calculation|Configuration|Directory|Instances?|Invocations?|Engine|Scope)$/i;
const STATUS_DIR_RE = /^(Active|Completed|In[- ]Progress|Suspended|Failed|Archived) (Instances?|Invocations?)( Directory)?$/i;
// Bare generic section headers that don't end in a tell-tale suffix above.
const GENERIC_SINGLE_WORD_TITLES = new Set([
  "execution", "implementation", "overview", "introduction", "background",
  "requirements", "parameters", "definitions", "general", "in general",
  "resources", "specification", "calculation", "details", "scope",
]);

function isGenericAncestor(node: AtlasNode): boolean {
  const t = node.title.trim();
  return (
    GENERIC_ANCESTOR_TYPES.has(node.type) ||
    GENERIC_TITLE_PREFIX_RE.test(t) ||
    GENERIC_TITLE_SUFFIX_RE.test(t) ||
    STATUS_DIR_RE.test(t) ||
    GENERIC_SINGLE_WORD_TITLES.has(t.toLowerCase())
  );
}

// Nearest non-generic ancestor's title, lowercased — or null if every
// ancestor up to the root is structural/generic (or the doc has no parent).
export function resolveOwner(docMap: Map<string, AtlasNode>, node: AtlasNode): string | null {
  let cur = node.parentId ? docMap.get(node.parentId) : undefined;
  while (cur) {
    if (!isGenericAncestor(cur)) return cur.title.trim().toLowerCase();
    cur = cur.parentId ? docMap.get(cur.parentId) : undefined;
  }
  return null;
}
