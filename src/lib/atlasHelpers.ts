import type { AtlasNode, AddressInfo } from "../types";
import type { ChainValue } from "./chainstate";
import type { AtlasBundle } from "./docs";
import type { FlatEntry } from "../components/atlas/CollapsibleNode";

export const UUID_LINK_RE = /\[[^\]]+\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/g;

export function extractLinkedIds(node: AtlasNode): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const m of node.content.matchAll(UUID_LINK_RE)) {
    if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
  }
  return ids;
}

export function buildAncestors(docs: Record<string, AtlasNode>, docNoToId: Map<string, string>, nodeId: string): AtlasNode[] {
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

export interface LoadedData {
  atlas: AtlasBundle;
  flatNodes: FlatEntry[];
  addresses: Record<string, AddressInfo>;
  chainState: { values: Record<string, Record<string, ChainValue>> };
}

export const ATLAS_GRID_STYLE: React.CSSProperties = { minHeight: 0, overflow: "hidden" };
export const ATLAS_LEFT_PANE_STYLE: React.CSSProperties = { borderRight: "1px solid var(--border)" };
export const ATLAS_EMPTY_SET: Set<string> = new Set();
