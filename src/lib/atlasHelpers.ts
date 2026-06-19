import type { AtlasNode, AddressInfo } from "../types";
import type { ChainValue } from "./chainstate";
import type { AtlasBundle } from "./docs";
import type { Glossary } from "./glossary";
import { realDepth, depthColor } from "./depth";

const UUID_LINK_RE =
  /\[[^\]]+\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/g;

// Replaces markdown links and images with their visible text. URL slugs often
// contain prose-like words ("…-due-to-…") that poison text heuristics, so any
// code matching against atlas prose should strip links with this first.
export const stripMarkdownLinks = (s: string): string =>
  s.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");

export function extractLinkedIds(node: AtlasNode): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const m of node.content.matchAll(UUID_LINK_RE)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      ids.push(m[1]);
    }
  }
  return ids;
}

export function buildAncestors(
  docs: Record<string, AtlasNode>,
  docNoToId: Map<string, string>,
  nodeId: string,
): AtlasNode[] {
  const node = docs[nodeId];
  if (!node || node.doc_no.startsWith("NR-")) return [];
  const ancestors: AtlasNode[] = [];
  const parts = node.doc_no.split(".");
  for (let i = 2; i < parts.length; i++) {
    const ancestorDocNo = parts.slice(0, i).join(".");
    const aid = docNoToId.get(ancestorDocNo);
    if (aid && docs[aid]) ancestors.push(docs[aid]);
  }
  return ancestors;
}

export function buildAncestorsWithSelf(
  docs: Record<string, AtlasNode>,
  docNoToId: Map<string, string>,
  nodeId: string,
): AtlasNode[] {
  const chain = buildAncestors(docs, docNoToId, nodeId);
  const self = docs[nodeId];
  return self ? [...chain, self] : chain;
}

export interface FlatEntry {
  node: AtlasNode;
  depth: number;
  color: string;
  hasContent: boolean;
}

export function flattenTree(byParent: Map<string | null, AtlasNode[]>): FlatEntry[] {
  const result: FlatEntry[] = [];
  function walk(parentId: string | null, parentDocNo?: string) {
    for (const node of byParent.get(parentId) ?? []) {
      const depth = realDepth(node.doc_no, parentDocNo);
      result.push({
        node,
        depth,
        color: depthColor(depth),
        hasContent: !!node.content,
      });
      walk(node.id, node.doc_no);
    }
  }
  walk(null);
  return result;
}

export interface LoadedData {
  atlas: AtlasBundle;
  flatNodes: FlatEntry[];
  addresses: Record<string, AddressInfo> | null;
  chainState: { values: Record<string, Record<string, ChainValue>> } | null;
  glossary: Glossary | null;
  // false during phase 1 (docs-shallow only — depth ≤ 5); true once docs-deep has
  // merged in. Lets the reader distinguish "this id isn't loaded yet" from "this id
  // doesn't exist" so a deep-link to a depth-6 node shows Loading, not Not-found.
  complete: boolean;
}

export const ATLAS_GRID_STYLE: React.CSSProperties = { minHeight: 0, overflow: "hidden" };
export const ATLAS_LEFT_PANE_STYLE: React.CSSProperties = {
  borderRight: "1px solid var(--border)",
};
export const ATLAS_EMPTY_SET: Set<string> = new Set();
