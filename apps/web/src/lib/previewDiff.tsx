import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useDataSource } from "./dataSource";
import type { DiffLine } from "@/lib/history";

// Doc ids the preview adds / changes vs current main (from GET diff.json).
// Drives the green new/changed redline indicators. `renumbered` maps a changed
// doc id to its [live, preview] doc numbers when the change includes a move.
// Empty (and no fetch) outside preview mode, so the default context works
// everywhere without a provider.
export interface PreviewDiff {
  added: Set<string>;
  changed: Set<string>;
  renumbered: Record<string, [string, string]>;
  /** Added docs whose doc number exists on the live atlas under another uuid:
   *  id → the old occupant's title + where it sits in this preview (absent =
   *  removed by the preview). */
  reusedSlot: Record<string, { title?: string; movedTo?: string }>;
  /** UUID-identity reassignment: a stable uuid whose underlying *document* was
   *  wholly replaced (different title + rewritten body). id → old/new titles and
   *  (best-effort) where the displaced old content moved to. Drives the ⚠. */
  identitySwap: Record<string, { oldTitle: string; newTitle: string; movedTo?: { id: string; doc_no: string; title: string } }>;
  /** The other side of a swap: a new doc that received content which previously
   *  lived under a different uuid. id → that previous uuid + its old identity. */
  formerUuid: Record<string, { previousId: string; previousTitle: string; previousDocNo: string }>;
}

const EMPTY: PreviewDiff = { added: new Set(), changed: new Set(), renumbered: {}, reusedSlot: {}, identitySwap: {}, formerUuid: {} };

const PreviewDiffContext = createContext<PreviewDiff>(EMPTY);

export function usePreviewDiff(): PreviewDiff {
  return useContext(PreviewDiffContext);
}

export function PreviewDiffProvider({ children }: { children: ReactNode }) {
  const { base, preview } = useDataSource();
  const [diff, setDiff] = useState<PreviewDiff>(EMPTY);
  useEffect(() => {
    if (!preview) {
      setDiff(EMPTY);
      return;
    }
    let live = true;
    fetch(`${base}diff.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d) return;
        setDiff({
          added: new Set<string>(d.added ?? []),
          changed: new Set<string>(d.changed ?? []),
          renumbered: d.renumbered ?? {},
          // Older bundles shipped reusedSlot as a bare id array — normalize.
          reusedSlot: Array.isArray(d.reusedSlot)
            ? Object.fromEntries((d.reusedSlot as string[]).map((id) => [id, {}]))
            : (d.reusedSlot ?? {}),
          // Both absent on bundles built before identity-swap detection shipped.
          identitySwap: d.identitySwap ?? {},
          formerUuid: d.formerUuid ?? {},
        });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [base, preview]);
  return <PreviewDiffContext.Provider value={diff}>{children}</PreviewDiffContext.Provider>;
}

// ---------------------------------------------------------------------------
// Lazy per-doc patches (GET patches.json). Larger than diff.json, so it's NOT
// loaded by the eager provider above — only fetched the first time a preview
// history tab mounts (usePreviewPatch), then cached per base. Maps doc id →
// rendered line diff in the same DiffLine[] shape the live history uses.
// ---------------------------------------------------------------------------

const patchCache = new Map<string, Promise<Record<string, DiffLine[]>>>();

function loadPreviewPatches(base: string): Promise<Record<string, DiffLine[]>> {
  let p = patchCache.get(base);
  if (!p) {
    p = fetch(`${base}patches.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
    patchCache.set(base, p);
  }
  return p;
}

export function usePreviewPatch(nodeId: string): DiffLine[] | null {
  const { base, preview } = useDataSource();
  const [lines, setLines] = useState<DiffLine[] | null>(null);
  useEffect(() => {
    if (!preview) {
      setLines(null);
      return;
    }
    let live = true;
    loadPreviewPatches(base).then((m) => {
      if (live) setLines(m[nodeId] ?? null);
    });
    return () => {
      live = false;
    };
  }, [base, preview, nodeId]);
  return lines;
}
