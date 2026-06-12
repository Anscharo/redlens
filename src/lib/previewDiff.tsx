import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useDataSource } from "./dataSource";
import type { DiffLine } from "./history";

// Doc ids the preview adds / changes vs current main (from GET diff.json).
// Drives the green new/changed redline indicators. `renumbered` maps a changed
// doc id to its [live, preview] doc numbers when the change includes a move.
// Empty (and no fetch) outside preview mode, so the default context works
// everywhere without a provider.
export interface PreviewDiff {
  added: Set<string>;
  changed: Set<string>;
  renumbered: Record<string, [string, string]>;
  /** Added docs whose doc number exists on the live atlas under another uuid. */
  reusedSlot: Set<string>;
}

const EMPTY: PreviewDiff = { added: new Set(), changed: new Set(), renumbered: {}, reusedSlot: new Set() };

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
          reusedSlot: new Set<string>(d.reusedSlot ?? []),
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
