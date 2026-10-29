// Address-matched names that more than one key carries. One listed address can
// derive several keys (an ERC-4626 withdraw and a Maple redeem from one vault),
// and "<instance> · <param>" alone cannot tell their rows apart, so each such
// ref is marked `shared` and the reader adds the key's controller constant.
// Pure.
import type { AtlasKeyRef } from "./pauView.ts";

const nameOf = (r: AtlasKeyRef) => [r.docId, r.label, r.chain ?? ""].join("\n");

/** The index with each `via` ref marked `shared` when the same name, from the same document and chain, also names another key. */
export function withSharedLabels(index: Map<string, AtlasKeyRef[]>): Map<string, AtlasKeyRef[]> {
  const keysByName = new Map<string, Set<string>>();
  for (const [key, refs] of index) for (const r of refs) if (r.via) keysByName.set(nameOf(r), (keysByName.get(nameOf(r)) ?? new Set()).add(key));
  const shared = (r: AtlasKeyRef) => !!r.via && (keysByName.get(nameOf(r))?.size ?? 0) > 1;
  return new Map([...index].map(([key, refs]) => [key, refs.map((r) => (shared(r) ? { ...r, shared: true } : r))]));
}
