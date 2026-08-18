// Embedding *units*: one vector can cover one doc or a small parent+children
// group. Grouping policy is a bakeoff variable (EMBED_GROUP_POLICY); this
// module is the single source of truth for unit text, hashing, tree
// containment, and query-time leaf attribution.
//
// parentId is unreliable past heading depth 6 (every ICD lives past that cap).
// Child/ancestor walks use doc_no arithmetic — see parse-atlas SKILL.md.
import { createHash } from "node:crypto";
import type { AtlasNode } from "../../types.ts";
import { buildEmbedText, contentHash as oneToOneHash } from "./embed-text.ts";
import { isICD } from "../../../scripts/lib/graph-patterns.mjs";
import { extractParamsFromRoot, buildChildrenIndex } from "../../../scripts/lib/graph-instances.mjs";
import { isGenericAncestor } from "../../lib/paramOwner.ts";
import { stripMarkdownLinks } from "../../lib/stripMarkdownLinks.ts";

// Matches graph-instances.mjs (directory placeholders, not leaves).
export const DIRECTORY_RE =
  /^The documents? herein (define|contain|organize|govern|specify|describe|set|compose|hold)\b/i;

export const HUB_TITLE_RE = /primitive hub document/i;

// Safety rail: never fold a named chunk root (a Prime Agent artifact is ~2k
// docs). directory_descendants is skipped when the descendant forest exceeds
// this; it is NOT a quality cap — those are bakeoff `--cap` values.
export const CHUNK_ROOT_MAX = 200;

export const GROUP_POLICIES = [
  "one_to_one",
  "icd_params",
  "icd_params_breadcrumbs",
  "icd_full_params_breadcrumbs",
  "directory_direct",
  "directory_descendants",
  "hub_stubs",
  "breadcrumbs",
  "kv_records_breadcrumbs",
] as const;
export type GroupPolicy = (typeof GROUP_POLICIES)[number];

export interface EmbedUnit {
  anchorId: string;
  memberIds: string[];
  text: string;
  hash: string;
  family: string;
}

export interface Via {
  group_id: string;
  group_title: string;
  match_scope: "child" | "group";
}

export interface UnitBuildOpts {
  // Soft per-unit member cap. Over-cap units split by first-level subgroups;
  // a subgroup still over cap falls back to 1:1 rather than truncating.
  cap?: number;
  // breadcrumbs only: keep just the N nearest ancestors (parent, grandparent, …)
  // instead of the whole root→leaf chain. undefined/0 = full chain (default).
  crumbDepth?: number;
  // Keep the ROOT ancestor in addition to the crumbDepth nearest ones.
  // Load-bearing for kv_records_breadcrumbs: those anchors are generically titled
  // ("Contract Addresses", "Freezer Multisig", "Base"), so the breadcrumb is the
  // only discriminator — and the discriminating token is the agent at the TOP of
  // the chain (Spark/Grove/Keel/Obex), which slice(-N) throws away. Measured on the
  // corpus: Freezer Multisig collapses 7 roots → 3 distinct crumbs at depth 2, but
  // root+depth-2 recovers all 7 — matching full-chain distinctiveness for one extra
  // crumb. Same for the relayer multisigs (6→3→6) and Contract Addresses (113→119).
  crumbRoot?: boolean;
  // Named breadcrumb strategy — supersedes crumbDepth/crumbRoot when set. See
  // CRUMB_STRATEGIES. Only ~143 units' text depends on this, so sweeping every
  // strategy in one eval run is cheap (the rest reuse cached vectors).
  crumbStrategy?: string;
}

// Breadcrumb selection strategies. Which ancestors land in the prefix decides
// whether two same-titled records are separable at all, and the 2026-08-18 A/B
// showed the choice is worth 11 of 40 disambiguation queries — so it is a first
// class swept parameter, not a boolean.
//
//   full              whole root→leaf chain
//   nearest:N         the N nearest ancestors (parent, grandparent, …)
//   root:M+nearest:N  the M outermost (agent/scope) plus the N nearest
//   distinct:N        the N RAREST ancestor titles corpus-wide, kept in chain order
//
// distinct:N ranks by corpus title frequency because a name shared by hundreds of
// docs ("Governance Processes") carries almost no identifying information while a
// rare one ("Obex") pins the instance exactly. Deterministic and needs no state
// beyond the doc set. The alternative — "keep ancestors that differ from other docs
// with this same title" — targets the confusion more directly but shifts whenever
// the atlas changes, so it is deliberately not implemented yet.
export const CRUMB_STRATEGIES = [
  "full",
  "nearest:2",
  "nearest:3",
  "nearest:4",
  "root:1+nearest:2",
  "root:2+nearest:3",
  "distinct:3",
  // raw: variants select from the unfiltered chain (avg 9.3 ancestors on an ICD
  // anchor vs 2.8 filtered), so rarity has something to choose between.
  "raw:full",
  "raw:distinct:3",
  "raw:distinct:4",
  // Pins the agent, then adds the rarest context — pure rarity drops the agent.
  "raw:agent+distinct:3",
] as const;

export type CrumbPlan = { raw?: boolean } & (
  | { kind: "full" }
  | { kind: "nearest"; n: number }
  | { kind: "rootNearest"; m: number; n: number }
  | { kind: "distinct"; n: number }
  | { kind: "agentDistinct"; n: number }
);

export function parseCrumbStrategy(s: string): CrumbPlan {
  let t = s.trim().toLowerCase();
  // raw: = select from the UNFILTERED ancestor chain (see ancestorTitles).
  let raw = false;
  if (t.startsWith("raw:")) {
    raw = true;
    t = t.slice(4);
  }
  const withRaw = (p: CrumbPlan): CrumbPlan => (raw ? { ...p, raw: true } : p);
  if (t === "full") return withRaw({ kind: "full" });
  let m = /^nearest:(\d+)$/.exec(t);
  if (m) return withRaw({ kind: "nearest", n: Number(m[1]) });
  m = /^root:(\d+)\+nearest:(\d+)$/.exec(t);
  if (m) return withRaw({ kind: "rootNearest", m: Number(m[1]), n: Number(m[2]) });
  m = /^distinct:(\d+)$/.exec(t);
  if (m) return withRaw({ kind: "distinct", n: Number(m[1]) });
  m = /^agent\+distinct:(\d+)$/.exec(t);
  if (m) return withRaw({ kind: "agentDistinct", n: Number(m[1]) });
  throw new Error(`unknown crumb strategy "${s}" (expected one of: ${CRUMB_STRATEGIES.join(", ")})`);
}

// crumbDepth/crumbRoot are the older knobs; map them onto a plan so both spellings
// keep working and only one code path applies the selection.
function planFromOpts(opts: UnitBuildOpts): CrumbPlan {
  if (opts.crumbStrategy) return parseCrumbStrategy(opts.crumbStrategy);
  if (!opts.crumbDepth || opts.crumbDepth <= 0) return { kind: "full" };
  return opts.crumbRoot
    ? { kind: "rootNearest", m: 1, n: opts.crumbDepth }
    : { kind: "nearest", n: opts.crumbDepth };
}

// The rarity signal behind distinct:N: how many docs sit UNDERNEATH each ancestor
// title, i.e. its document frequency as context.
//
// NOT "how many docs carry this title" — that inverts the ranking exactly where it
// matters. "The Agent Scope" is a single document, so by title count it looks
// maximally rare and distinct:N would keep it; but it is an ancestor of thousands of
// docs, so it distinguishes nothing. Counting descendants gets both right: the four
// universal names sort to the bottom, "Demand Side Stablecoin Primitives" to the top.
function ancestorDocFrequency(docs: AtlasNode[], byDocNo: Map<string, AtlasNode>): Map<string, number> {
  const freq = new Map<string, number>();
  for (const d of docs) {
    let cur = parentDocNo(d.doc_no);
    const seen = new Set<string>();
    while (cur) {
      const n = byDocNo.get(cur);
      // A title repeated at two levels of one chain still counts once for that doc.
      if (n && !seen.has(n.title)) {
        seen.add(n.title);
        freq.set(n.title, (freq.get(n.title) ?? 0) + 1);
      }
      cur = parentDocNo(cur);
    }
  }
  return freq;
}

export function selectCrumbs(
  crumbs: string[],
  plan: CrumbPlan,
  titleFreq?: Map<string, number>,
  pinned: string[] = [],
): string[] {
  if (plan.kind === "full" || crumbs.length === 0) return crumbs;
  if (plan.kind === "nearest") return crumbs.length > plan.n ? crumbs.slice(-plan.n) : crumbs;
  if (plan.kind === "rootNearest") {
    if (crumbs.length <= plan.m + plan.n) return crumbs;
    return [...crumbs.slice(0, plan.m), ...crumbs.slice(-plan.n)];
  }
  if (plan.kind === "agentDistinct") {
    // Pin the agent, then take the N rarest of the rest. Pure rarity drops the
    // agent — 2,441 docs sit under "Spark", counting as commoner than "Genesis
    // Primitives" (783) — yet the agent is the main cross-agent discriminator.
    // `pinned` is supplied by the caller because "the agent" is the first
    // NON-generic ancestor, which a raw chain (headed by "The Agent Scope") can't
    // identify on its own.
    const head = pinned.filter((t) => crumbs.includes(t));
    const rest = crumbs.filter((t) => !head.includes(t));
    if (head.length + rest.length <= plan.n + head.length && rest.length <= plan.n) return crumbs;
    const picked = rest
      .map((title, i) => ({ title, i, f: titleFreq?.get(title) ?? 1 }))
      .sort((a, b) => a.f - b.f || a.i - b.i)
      .slice(0, plan.n)
      .sort((a, b) => a.i - b.i)
      .map((r) => r.title);
    return [...head, ...picked];
  }
  if (crumbs.length <= plan.n) return crumbs;
  // Rarest-first by corpus title frequency, then restored to chain order so the
  // crumb still reads root→leaf. Ties break on position (outermost first) to stay
  // deterministic across runs.
  const ranked = crumbs
    .map((title, i) => ({ title, i, f: titleFreq?.get(title) ?? 1 }))
    .sort((a, b) => a.f - b.f || a.i - b.i)
    .slice(0, plan.n)
    .sort((a, b) => a.i - b.i);
  return ranked.map((r) => r.title);
}

export function isDocNoDescendant(child: string, ancestor: string): boolean {
  // Trailing dot is load-bearing: "A.1.11" must not count as under "A.1.1".
  return child.startsWith(ancestor + ".");
}

export function parentDocNo(docNo: string): string | null {
  const last = docNo.lastIndexOf(".");
  return last < 0 ? null : docNo.slice(0, last);
}

export function unitHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function queryTerms(query: string): string[] {
  return (query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 2);
}

export function leafScore(query: string, node: Pick<AtlasNode, "title" | "content">): number {
  const terms = queryTerms(query);
  const title = node.title.toLowerCase();
  const content = (node.content ?? "").toLowerCase();
  let s = 0;
  for (const t of terms) {
    if (title.includes(t)) s += 3;
    if (content.includes(t)) s += 1;
  }
  return s;
}

// Optional semantic scorer: id -> similarity, or undefined when no vector is known.
// Supplied by search.ts, which has the query embedding and the members' vectors;
// embed-units stays free of DB and network dependencies so it remains pure and
// unit-testable.
export type LeafSemanticScore = (id: string) => number | undefined;

export function pickLeaf(
  query: string,
  members: AtlasNode[],
  anchor: AtlasNode,
  semantic?: LeafSemanticScore,
): { node: AtlasNode; match_scope: "child" | "group" } {
  // Semantic attribution when vectors are available for at least two members —
  // with one there is nothing to choose between and the lexical path is as good.
  //
  // Measured 2026-08-18 (scripts/aux/leaf-attribution-experiment.ts, 98 queries whose
  // target is folded): lexical term-overlap is 34% accurate and is the single biggest
  // loss in the pipeline — retrieval reaches the right group for essentially every ICD
  // query (recall 1.000) and attribution then discards two thirds of them. Scoring
  // against a residual query embedding (the question minus the instance names, which
  // discriminate nothing INSIDE a group) measures 51%.
  if (semantic) {
    const scored = members
      .map((m) => ({ m, s: semantic(m.id) }))
      .filter((x): x is { m: AtlasNode; s: number } => typeof x.s === "number");
    if (scored.length >= 2) {
      scored.sort((a, b) => b.s - a.s);
      const top = scored[0]!.m;
      if (top.id === anchor.id) return { node: anchor, match_scope: "group" };
      return { node: top, match_scope: "child" };
    }
  }
  const terms = queryTerms(query);
  const titleHit = (n: AtlasNode) => terms.some((t) => n.title.toLowerCase().includes(t));
  const children = members.filter((m) => m.id !== anchor.id);
  // A child whose TITLE matches a query term (e.g. "Network" in "SparkLend USDS
  // Network") beats the anchor even when the anchor's longer title overlaps more
  // instance-name tokens. Fall back to scoring everyone when no child title hits
  // (value queries like "Ethereum Mainnet").
  const titled = children.filter(titleHit);
  const pool = titled.length > 0 ? titled : members;
  let best = titled.length > 0 ? titled[0]! : anchor;
  let bestScore = leafScore(query, best);
  for (const m of pool) {
    const sc = leafScore(query, m);
    if (sc > bestScore) {
      bestScore = sc;
      best = m;
    }
  }
  if (best.id === anchor.id) return { node: anchor, match_scope: "group" };
  return { node: best, match_scope: bestScore > 0 ? "child" : "group" };
}

// Rewrite a semantic (group-anchor) hit to the matching leaf, then collapse
// onto a more-specific lexical descendant when one exists. Sibling hits are
// not fused — Network and Reward Code under the same ICD stay two results.
export function rewriteSemanticHit(
  query: string,
  semId: string,
  memberIds: string[] | undefined,
  lex: { id: string; doc_no: string }[],
  docMap: Map<string, AtlasNode>,
  semantic?: LeafSemanticScore,
): { id: string; via?: Via } {
  const anchor = docMap.get(semId);
  if (!anchor) return { id: semId };
  const ids = memberIds && memberIds.length > 0 ? memberIds : [semId];
  const members = ids.map((id) => docMap.get(id)).filter((n): n is AtlasNode => !!n);
  const picked = pickLeaf(query, members, anchor, semantic);
  let id = picked.node.id;
  for (const l of lex) {
    if (l.id === id) continue;
    if (isDocNoDescendant(l.doc_no, picked.node.doc_no)) {
      id = l.id;
      break; // lex is rank-ordered — keep the highest-ranked descendant
    }
  }
  const via: Via | undefined =
    ids.length > 1
      ? { group_id: anchor.id, group_title: anchor.title, match_scope: picked.match_scope }
      : undefined;
  return { id, via };
}

export function descendantsOf(docNo: string, childrenByDocNo: Map<string, AtlasNode[]>): AtlasNode[] {
  const out: AtlasNode[] = [];
  const stack = [...(childrenByDocNo.get(docNo) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    out.push(n);
    const kids = childrenByDocNo.get(n.doc_no);
    if (kids) stack.push(...kids);
  }
  return out;
}

// includeGeneric=false (default) drops "structural" ancestors via isGenericAncestor.
// That filter is borrowed from paramOwner.ts, which answers a DIFFERENT question —
// "which entity owns this parameter" — and it is blunt here: on ICD anchors it cuts
// the chain from 9.3 names to 2.8, discarding real distinctions ("Supply Side" vs
// "Demand Side Stablecoin Primitives", "Ethereum Mainnet Instances", Active vs
// Completed) alongside the four names that sit on all 230 anchors and carry nothing.
// includeGeneric=true keeps everything and lets a rarity-based strategy do the
// discarding instead — see the raw: strategies.
export function ancestorTitles(
  node: AtlasNode,
  byDocNo: Map<string, AtlasNode>,
  includeGeneric = false,
): string[] {
  const titles: string[] = [];
  let cur = parentDocNo(node.doc_no);
  while (cur) {
    const n = byDocNo.get(cur);
    if (n && (includeGeneric || !isGenericAncestor(n))) titles.push(n.title);
    cur = parentDocNo(cur);
  }
  return titles.reverse();
}

// Links stripped to match buildEmbedText: a grouped anchor must not carry raw
// markdown link targets when its 1:1 siblings no longer do.
function oneLiner(content: string): string {
  return stripMarkdownLinks(content ?? "").trim().replace(/\s+/g, " ").slice(0, 160);
}

function makeUnit(anchorId: string, memberIds: string[], text: string, family: string): EmbedUnit {
  return { anchorId, memberIds, text, hash: unitHash(text), family };
}

function oneToOneUnit(node: AtlasNode, family = "one_to_one"): EmbedUnit {
  const text = buildEmbedText(node);
  return { anchorId: node.id, memberIds: [node.id], text, hash: oneToOneHash(node), family };
}

// Bounded breadcrumb string ("parent > grandparent") with a trailing "\n\n", or
// "" when the node has no (non-generic) ancestors. crumbDepth keeps only the N
// nearest ancestors; ancestorTitles is root→leaf so slice(-N) is the tail.
function crumbPrefix(
  node: AtlasNode,
  byDocNo: Map<string, AtlasNode>,
  plan: CrumbPlan,
  titleFreq?: Map<string, number>,
): string {
  const pinned = plan.kind === "agentDistinct" ? ancestorTitles(node, byDocNo, false).slice(0, 1) : [];
  const crumbs = selectCrumbs(ancestorTitles(node, byDocNo, plan.raw), plan, titleFreq, pinned);
  return crumbs.length ? `${crumbs.join(" > ")}\n\n` : "";
}

function breadcrumbUnit(
  node: AtlasNode,
  byDocNo: Map<string, AtlasNode>,
  plan: CrumbPlan,
  titleFreq?: Map<string, number>,
): EmbedUnit {
  const text = `${crumbPrefix(node, byDocNo, plan, titleFreq)}${buildEmbedText(node)}`;
  return makeUnit(node.id, [node.id], text, "breadcrumbs");
}

// Values are link-stripped for the same reason as oneLiner. Stripped HERE and not
// in extractParamsFromRoot: the graph build reads those same param values to pull
// addresses and emit has_address edges, and must keep seeing raw markdown.
function kvText(title: string, params: Record<string, [string, string, string]>): string {
  const lines = Object.entries(params).map(([k, [v]]) => `${k}: ${stripMarkdownLinks(v)}`);
  return lines.length ? `${title}\n\n${lines.join("\n")}` : title;
}

const CUSTOM_PARAMS_RE = /^custom instance parameters$/i;

function skipCustom(n: AtlasNode): boolean {
  return CUSTOM_PARAMS_RE.test(n.title);
}

// An ICD's param containers. The canonical `Parameters` child is only one of them:
// `Instance-specific Operational Parameters` (23 ICDs) holds the Contract Addresses
// and Risk Parameters blocks — bare `0x…` and numeric leaves, the thinnest docs in
// the corpus — and an exact-title match missed it entirely, leaving those leaves
// embedded 1:1. Each container becomes its OWN unit rather than being merged into
// the ICD's: measured, merging pushes the anchor text to max 2,225 chars (over the
// compact-anchor budget the bakeoff winner sits in) while separate units stay at
// p50 475 / max 828.
const PARAM_ROOT_RE = /\bparameters$/i;

function paramRoots(
  icd: AtlasNode,
  childrenByDocNo: Map<string, AtlasNode[]>,
): { primary: AtlasNode | undefined; extra: AtlasNode[] } {
  const kids = childrenByDocNo.get(icd.doc_no) ?? [];
  const primary = kids.find((c) => c.title === "Parameters");
  const extra = kids.filter(
    (c) => c !== primary && PARAM_ROOT_RE.test(c.title) && !CUSTOM_PARAMS_RE.test(c.title),
  );
  return { primary, extra };
}

// Split an over-cap member set by the anchor's first-level children. A
// subgroup still over cap falls back to 1:1 for those members (never truncate).
function splitBySubgroup(
  anchor: AtlasNode,
  memberSet: Set<string>,
  byId: Map<string, AtlasNode>,
  childrenByDocNo: Map<string, AtlasNode[]>,
  cap: number,
  family: string,
  textFor: (subAnchor: AtlasNode, members: AtlasNode[]) => string,
): EmbedUnit[] {
  const units: EmbedUnit[] = [];
  const claimed = new Set<string>();
  const kids = childrenByDocNo.get(anchor.doc_no) ?? [];
  for (const kid of kids) {
    const sub = [kid, ...descendantsOf(kid.doc_no, childrenByDocNo)].filter((n) => memberSet.has(n.id));
    if (sub.length === 0) continue;
    if (sub.length > cap) {
      for (const n of sub) {
        units.push(oneToOneUnit(n, family));
        claimed.add(n.id);
      }
      continue;
    }
    const members = [anchor, ...sub.filter((n) => n.id !== anchor.id)];
    const ids = [...new Set(members.map((n) => n.id))];
    units.push(makeUnit(kid.id, ids, textFor(kid, members), family));
    for (const n of sub) claimed.add(n.id);
  }
  for (const id of memberSet) {
    if (claimed.has(id) || id === anchor.id) continue;
    const n = byId.get(id);
    if (n) units.push(oneToOneUnit(n, family));
  }
  return units;
}

function icdParamUnits(
  docs: AtlasNode[],
  byId: Map<string, AtlasNode>,
  childrenByDocNo: Map<string, AtlasNode[]>,
  cap: number | undefined,
  crumbOpts?: { byDocNo: Map<string, AtlasNode>; plan: CrumbPlan; titleFreq?: Map<string, number>; fullProse?: boolean },
): { units: EmbedUnit[]; grouped: Set<string> } {
  const units: EmbedUnit[] = [];
  const grouped = new Set<string>();
  const fullProse = crumbOpts?.fullProse ?? false;
  const family = !crumbOpts
    ? "icd_params"
    : fullProse
      ? "icd_full_params_breadcrumbs"
      : "icd_params_breadcrumbs";
  // fullProse keeps every folded member's whole text (no summarization loss),
  // then appends the structured param key:values; otherwise just the kv summary.
  const anchorText = (prefix: string, members: AtlasNode[], kv: string) =>
    fullProse ? `${prefix}${members.map((m) => buildEmbedText(m)).join("\n\n")}\n\n${kv}` : `${prefix}${kv}`;
  // One grouped unit per param container. `anchor` is the doc the vector is
  // addressed by (the ICD itself for its canonical `Parameters` block; the
  // container for a sibling block, so the two stay separately addressable);
  // `root` is the subtree supplying the kv values.
  const emit = (anchor: AtlasNode, root: AtlasNode, kvTitle: string) => {
    const members: AtlasNode[] = [anchor];
    const walk = [root];
    while (walk.length) {
      const n = walk.pop()!;
      if (skipCustom(n)) continue;
      if (n.id !== anchor.id) members.push(n);
      for (const c of childrenByDocNo.get(n.doc_no) ?? []) walk.push(c);
    }
    const memberSet = new Set(members.map((n) => n.id));
    const params = extractParamsFromRoot(root, childrenByDocNo) as Record<string, [string, string, string]>;
    // Fused policies prepend the anchor's own (bounded) breadcrumb — ancestral
    // context (primitive/scope, and for a sibling container the ICD title itself)
    // that disambiguates near-duplicate instances. Only grouped anchors change
    // text; standalone docs stay one_to_one downstream.
    const prefix = crumbOpts ? crumbPrefix(anchor, crumbOpts.byDocNo, crumbOpts.plan, crumbOpts.titleFreq) : "";
    if (cap && members.length > cap) {
      const split = splitBySubgroup(root, memberSet, byId, childrenByDocNo, cap, family, (sub, subMembers) =>
        anchorText(prefix, subMembers, kvText(`${kvTitle} — ${sub.title}`, params)),
      );
      for (const u of split) {
        units.push(u);
        if (u.memberIds.length > 1) for (const id of u.memberIds) if (id !== u.anchorId) grouped.add(id);
      }
      return;
    }
    units.push(
      makeUnit(anchor.id, members.map((n) => n.id), anchorText(prefix, members, kvText(kvTitle, params)), family),
    );
    for (const n of members) if (n.id !== anchor.id) grouped.add(n.id);
  };

  for (const icd of docs) {
    if (!isICD(icd)) continue;
    const { primary, extra } = paramRoots(icd, childrenByDocNo);
    if (primary) emit(icd, primary, icd.title);
    // Sibling containers keep the instance name in the kv title so the unit is
    // still attributable when the container title alone is generic.
    for (const root of extra) emit(root, root, `${icd.title} — ${root.title}`);
  }
  return { units, grouped };
}

// ── Generic kv-record folding (kv_records_breadcrumbs) ──────────────────────
//
// The ICD policy's win came from a specific recipe — fold a tight subtree of thin
// leaves into ONE compact key:value anchor with a bounded breadcrumb. That recipe
// was only ever pointed at ICD Parameters trees. The corpus has the same shape in
// many other families: multisig records (Address / Required Number Of Signers /
// Signers), Contract Addresses blocks (role → bare `0x…`), Risk Parameters Current
// Configuration, On-chain Parameters, Role Hierarchy And Permissions, Parties To
// The Accord, per-chain ALM contract blocks.
//
// Two constraints are load-bearing, both measured:
//   1. INNERMOST-first. Choosing outermost roots instead folds 55% of the corpus
//      into units reaching 21K chars — i.e. it reproduces directory_descendants,
//      which already lost the bakeoff. Innermost keeps p50 ~860 / max ~2,200,
//      matching the winner's profile.
//   2. The scaffolding filter below. Without it the three largest "families" are
//      pure structural boilerplate with mutually-indistinguishable bodies
//      (Archived Invocations/Instances: 136 roots, 18 distinct bodies — 87%
//      duplicate), which would add near-duplicate vectors and undo the
//      disambiguation the ICD policy bought.
const KV_MAX_MEMBERS = 20;
const KV_MAX_TEXT = 2200;
const KV_MIN_VALUES = 2;
const KV_MIN_VALUE_SHARE = 0.6;

// Leaf content that is structural scaffolding rather than a value. DIRECTORY_RE
// only matches "^The documents herein <verb>"; these are the other self-referential
// forms the corpus uses. A NEW regex rather than a reused one because the closest
// existing census (conceptsCensus.ts's censusEmptyScaffolding) keys on status-bucket
// *title* patterns, not on content prose — a different signature entirely.
// "has no dependencies" is deliberately NOT here: a stated absence is a real value.
const SCAFFOLD_RE = new RegExp(
  [
    String.raw`\b(?:are|is) (?:stored|contained) (?:here|herein)\b`, // "The subtrees for … are stored here."
    String.raw`\b(?:are|is) specified herein\b`, // "Triggers are specified herein."
    String.raw`\bcontains? a directory\b`, // "This document contains a Directory of…"
    String.raw`^\[see below\]`,
    String.raw`^none\.?$`,
  ].join("|"),
  "i",
);

function isScaffoldValue(v: string): boolean {
  const t = v.trim();
  return !t || DIRECTORY_RE.test(t) || SCAFFOLD_RE.test(t);
}

function kvRecordUnits(
  docs: AtlasNode[],
  childrenByDocNo: Map<string, AtlasNode[]>,
  byDocNo: Map<string, AtlasNode>,
  claimed: Set<string>,
  plan: CrumbPlan,
  titleFreq: Map<string, number>,
): { units: EmbedUnit[]; grouped: Set<string> } {
  interface Cand {
    root: AtlasNode;
    members: AtlasNode[];
    text: string;
  }
  const cands: Cand[] = [];
  for (const root of docs) {
    if (claimed.has(root.id)) continue;
    const forest = descendantsOf(root.doc_no, childrenByDocNo);
    if (forest.length < 2 || forest.length > KV_MAX_MEMBERS) continue;
    if (forest.some((n) => claimed.has(n.id))) continue;
    const leaves = forest.filter((n) => (childrenByDocNo.get(n.doc_no) ?? []).length === 0);
    if (leaves.length === 0) continue;
    // Reuse the shared param extractor rather than a second kv walk, then drop
    // scaffolding values (the extractor only filters DIRECTORY_RE).
    const raw = extractParamsFromRoot(root, childrenByDocNo) as Record<string, [string, string, string]>;
    const params = Object.fromEntries(Object.entries(raw).filter(([, v]) => !isScaffoldValue(v[0])));
    const nValues = Object.keys(params).length;
    if (nValues < KV_MIN_VALUES || nValues / leaves.length < KV_MIN_VALUE_SHARE) continue;
    const text = `${crumbPrefix(root, byDocNo, plan, titleFreq)}${kvText(root.title, params)}`;
    if (text.length > KV_MAX_TEXT) continue;
    cands.push({ root, members: [root, ...forest], text });
  }

  // Innermost-first, then greedily claim non-overlapping roots so no doc is folded
  // into two units.
  cands.sort((a, b) => a.members.length - b.members.length || a.root.doc_no.localeCompare(b.root.doc_no));
  const units: EmbedUnit[] = [];
  const grouped = new Set<string>();
  const taken = new Set<string>();
  for (const c of cands) {
    if (c.members.some((n) => taken.has(n.id))) continue;
    units.push(makeUnit(c.root.id, c.members.map((n) => n.id), c.text, "kv_records"));
    for (const n of c.members) {
      taken.add(n.id);
      if (n.id !== c.root.id) grouped.add(n.id);
    }
  }
  return { units, grouped };
}

function directoryUnits(
  docs: AtlasNode[],
  childrenByDocNo: Map<string, AtlasNode[]>,
  cap: number | undefined,
  mode: "direct" | "descendants" | "hub",
): { units: EmbedUnit[]; grouped: Set<string> } {
  const units: EmbedUnit[] = [];
  const grouped = new Set<string>();
  const family = mode === "hub" ? "hub_stubs" : mode === "direct" ? "directory_direct" : "directory_descendants";
  for (const dir of docs) {
    const isHub = HUB_TITLE_RE.test(dir.title);
    if (mode === "hub" && !isHub) continue;
    if (mode !== "hub" && !DIRECTORY_RE.test((dir.content ?? "").trim())) continue;
    if (mode === "descendants" && isHub) continue;
    const kids = childrenByDocNo.get(dir.doc_no) ?? [];
    if (kids.length === 0) continue;
    const forest = descendantsOf(dir.doc_no, childrenByDocNo);
    if (mode === "descendants" && forest.length > CHUNK_ROOT_MAX) continue;
    const members = mode === "descendants" ? [dir, ...forest] : [dir, ...kids];
    if (cap && members.length > cap) {
      // Over cap: do not silently drop children; leave this directory 1:1.
      continue;
    }
    const lines = (mode === "descendants" ? forest : kids).map((c) => `${c.title}: ${oneLiner(c.content)}`);
    const text = `${dir.title}\n\n${lines.join("\n")}`;
    units.push(makeUnit(dir.id, members.map((n) => n.id), text, family));
    for (const n of members) if (n.id !== dir.id) grouped.add(n.id);
  }
  return { units, grouped };
}

export function buildUnits(docs: AtlasNode[], policy: GroupPolicy, opts: UnitBuildOpts = {}): EmbedUnit[] {
  const byId = new Map(docs.map((d) => [d.id, d]));
  const byDocNo = new Map(docs.map((d) => [d.doc_no, d]));
  const childrenByDocNo = buildChildrenIndex(docs) as Map<string, AtlasNode[]>;
  const cap = opts.cap;

  // One plan for the whole build; titleFrequency is only consulted by distinct:N
  // but is cheap enough (one pass) to compute unconditionally.
  const plan = planFromOpts(opts);
  const titleFreq = ancestorDocFrequency(docs, byDocNo);

  if (policy === "one_to_one") return docs.map((d) => oneToOneUnit(d));
  if (policy === "breadcrumbs") return docs.map((d) => breadcrumbUnit(d, byDocNo, plan, titleFreq));

  const crumbOpts = { byDocNo, plan, titleFreq };
  let extra: { units: EmbedUnit[]; grouped: Set<string> };
  if (policy === "icd_params") extra = icdParamUnits(docs, byId, childrenByDocNo, cap);
  else if (policy === "icd_params_breadcrumbs") extra = icdParamUnits(docs, byId, childrenByDocNo, cap, crumbOpts);
  else if (policy === "icd_full_params_breadcrumbs")
    extra = icdParamUnits(docs, byId, childrenByDocNo, cap, { ...crumbOpts, fullProse: true });
  else if (policy === "kv_records_breadcrumbs") {
    // Composed, because EMBED_GROUP_POLICY is a single value: run the already
    // eval-won ICD pass first, then the generic kv pass over whatever it didn't
    // claim. Grouped ICD anchors are claimed too, so the generic pass can't fold a
    // subtree that an ICD unit already owns.
    const icd = icdParamUnits(docs, byId, childrenByDocNo, cap, crumbOpts);
    const claimed = new Set(icd.grouped);
    for (const u of icd.units) if (u.memberIds.length > 1) claimed.add(u.anchorId);
    // A bare nearest:N plan is upgraded to keep the root for this pass only. Not a
    // tuning knob but a correctness property: these anchors are generically titled,
    // so without the root ancestor 13 of the 696 units come out BYTE-IDENTICAL to
    // another unit (e.g. Grove's and Obex's "Freezer Multisig") — duplicate vectors
    // no ranker could separate. Explicit crumbRoot:false, or any other named
    // strategy, is respected as given so an eval arm can measure the difference.
    const kvPlan: CrumbPlan =
      plan.kind === "nearest" && opts.crumbRoot !== false && !opts.crumbStrategy
        ? { kind: "rootNearest", m: 1, n: plan.n }
        : plan;
    const kv = kvRecordUnits(docs, childrenByDocNo, byDocNo, claimed, kvPlan, titleFreq);
    extra = { units: [...icd.units, ...kv.units], grouped: new Set([...icd.grouped, ...kv.grouped]) };
  } else if (policy === "directory_direct") extra = directoryUnits(docs, childrenByDocNo, cap, "direct");
  else if (policy === "directory_descendants") extra = directoryUnits(docs, childrenByDocNo, cap, "descendants");
  else extra = directoryUnits(docs, childrenByDocNo, cap, "hub");

  const units = [...extra.units];
  // Set, not units.some(): the composed policy pushes unit counts into the
  // thousands and a linear scan per doc made this quadratic over the whole corpus.
  const anchors = new Set(extra.units.map((u) => u.anchorId));
  for (const d of docs) {
    if (extra.grouped.has(d.id) || anchors.has(d.id)) continue;
    units.push(oneToOneUnit(d, policy));
  }
  return units;
}

export function foldedIds(units: EmbedUnit[]): Set<string> {
  const anchors = new Set(units.map((u) => u.anchorId));
  const folded = new Set<string>();
  for (const u of units) {
    for (const id of u.memberIds) if (!anchors.has(id)) folded.add(id);
  }
  return folded;
}
