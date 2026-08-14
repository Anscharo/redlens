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
import { extractInstanceParams, buildChildrenIndex } from "../../../scripts/lib/graph-instances.mjs";
import { isGenericAncestor } from "../../lib/paramOwner.ts";

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
  "directory_direct",
  "directory_descendants",
  "hub_stubs",
  "breadcrumbs",
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

export function pickLeaf(
  query: string,
  members: AtlasNode[],
  anchor: AtlasNode,
): { node: AtlasNode; match_scope: "child" | "group" } {
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
): { id: string; via?: Via } {
  const anchor = docMap.get(semId);
  if (!anchor) return { id: semId };
  const ids = memberIds && memberIds.length > 0 ? memberIds : [semId];
  const members = ids.map((id) => docMap.get(id)).filter((n): n is AtlasNode => !!n);
  const picked = pickLeaf(query, members, anchor);
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

export function ancestorTitles(node: AtlasNode, byDocNo: Map<string, AtlasNode>): string[] {
  const titles: string[] = [];
  let cur = parentDocNo(node.doc_no);
  while (cur) {
    const n = byDocNo.get(cur);
    if (n && !isGenericAncestor(n)) titles.push(n.title);
    cur = parentDocNo(cur);
  }
  return titles.reverse();
}

function oneLiner(content: string): string {
  return (content ?? "").trim().replace(/\s+/g, " ").slice(0, 160);
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
function crumbPrefix(node: AtlasNode, byDocNo: Map<string, AtlasNode>, crumbDepth?: number): string {
  let crumbs = ancestorTitles(node, byDocNo);
  if (crumbDepth && crumbDepth > 0) crumbs = crumbs.slice(-crumbDepth);
  return crumbs.length ? `${crumbs.join(" > ")}\n\n` : "";
}

function breadcrumbUnit(node: AtlasNode, byDocNo: Map<string, AtlasNode>, crumbDepth?: number): EmbedUnit {
  const text = `${crumbPrefix(node, byDocNo, crumbDepth)}${buildEmbedText(node)}`;
  return makeUnit(node.id, [node.id], text, "breadcrumbs");
}

function kvText(title: string, params: Record<string, [string, string, string]>): string {
  const lines = Object.entries(params).map(([k, [v]]) => `${k}: ${v}`);
  return lines.length ? `${title}\n\n${lines.join("\n")}` : title;
}

function skipCustom(n: AtlasNode): boolean {
  return /^custom instance parameters$/i.test(n.title);
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
  crumbOpts?: { byDocNo: Map<string, AtlasNode>; crumbDepth?: number },
): { units: EmbedUnit[]; grouped: Set<string> } {
  const units: EmbedUnit[] = [];
  const grouped = new Set<string>();
  const family = crumbOpts ? "icd_params_breadcrumbs" : "icd_params";
  for (const icd of docs) {
    if (!isICD(icd)) continue;
    const kids = childrenByDocNo.get(icd.doc_no) ?? [];
    const paramsDoc = kids.find((c) => c.title === "Parameters");
    if (!paramsDoc) continue;
    const members: AtlasNode[] = [icd];
    const walk = [paramsDoc];
    while (walk.length) {
      const n = walk.pop()!;
      if (skipCustom(n)) continue;
      members.push(n);
      for (const c of childrenByDocNo.get(n.doc_no) ?? []) walk.push(c);
    }
    const memberSet = new Set(members.map((n) => n.id));
    const params = extractInstanceParams(icd, childrenByDocNo) as Record<string, [string, string, string]>;
    // Fused policy prepends the ICD's own (bounded) breadcrumb to the grouped
    // anchor — ancestral context (primitive/scope) that disambiguates
    // near-duplicate instances, on top of the folded param key:values. Only the
    // grouped anchors change text; standalone docs stay one_to_one downstream.
    const prefix = crumbOpts ? crumbPrefix(icd, crumbOpts.byDocNo, crumbOpts.crumbDepth) : "";
    const text = `${prefix}${kvText(icd.title, params)}`;
    if (cap && members.length > cap) {
      const split = splitBySubgroup(paramsDoc, memberSet, byId, childrenByDocNo, cap, family, (sub, _m) =>
        `${prefix}${kvText(`${icd.title} — ${sub.title}`, params)}`,
      );
      for (const u of split) {
        units.push(u);
        if (u.memberIds.length > 1) for (const id of u.memberIds) if (id !== u.anchorId) grouped.add(id);
      }
      continue;
    }
    units.push(makeUnit(icd.id, members.map((n) => n.id), text, family));
    for (const n of members) if (n.id !== icd.id) grouped.add(n.id);
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

  if (policy === "one_to_one") return docs.map((d) => oneToOneUnit(d));
  if (policy === "breadcrumbs") return docs.map((d) => breadcrumbUnit(d, byDocNo, opts.crumbDepth));

  let extra: { units: EmbedUnit[]; grouped: Set<string> };
  if (policy === "icd_params") extra = icdParamUnits(docs, byId, childrenByDocNo, cap);
  else if (policy === "icd_params_breadcrumbs")
    extra = icdParamUnits(docs, byId, childrenByDocNo, cap, { byDocNo, crumbDepth: opts.crumbDepth });
  else if (policy === "directory_direct") extra = directoryUnits(docs, childrenByDocNo, cap, "direct");
  else if (policy === "directory_descendants") extra = directoryUnits(docs, childrenByDocNo, cap, "descendants");
  else extra = directoryUnits(docs, childrenByDocNo, cap, "hub");

  const units = [...extra.units];
  for (const d of docs) {
    if (extra.grouped.has(d.id)) continue;
    if (units.some((u) => u.anchorId === d.id)) continue;
    units.push(oneToOneUnit(d, extra.units[0]?.family ?? policy));
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
