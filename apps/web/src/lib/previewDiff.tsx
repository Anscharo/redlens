import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useDataSource } from "./dataSource";
import { usePreviewView } from "./previewView";
import type { ActiveBase, PreviewBaseKey } from "./previewMetaCopy";
import type { DiffLine } from "@/lib/history";
import { fetchPreviewDiff } from "./previewDiffLoad";
import { loadIdentityVerdict } from "./previewIdentity";

// Doc ids the preview adds / changes vs current main (from GET diff.json).
// Drives the green new/changed redline indicators. `renumbered` maps a changed
// doc id to its [live, preview] doc numbers when the change includes a move.
// Empty (and no fetch) outside preview mode, so the default context works
// everywhere without a provider.
/** UUID-identity reassignment value: id → old/new titles and (best-effort)
 *  where the displaced old content moved to. */
export interface IdentitySwap {
  oldTitle: string;
  newTitle: string;
  movedTo?: { id: string; doc_no: string; title: string };
}

/** The other side of a swap: a doc that received content which previously
 *  lived under a different uuid. */
export interface FormerUuid {
  previousId: string;
  previousTitle: string;
  previousDocNo: string;
}

export interface PreviewDiff {
  added: Set<string>;
  changed: Set<string>;
  renumbered: Record<string, [string, string]>;
  /** Changed docs whose only change is the doc number. Absent on bundles
   *  built before the build recorded it. */
  renumberedOnly?: Set<string>;
  /** Changed docs whose title differs from the live atlas (title-only or
   *  title+content edits). id → [live title, preview title]. */
  retitled: Record<string, [string, string]>;
  /** Changed docs whose `[Type]` differs from the live atlas: id → [live type,
   *  preview type]. */
  retyped: Record<string, [string, string]>;
  /** Added docs whose doc number exists on the live atlas under another uuid:
   *  id → the old occupant's title + where it sits in this preview (absent =
   *  removed by the preview). */
  reusedSlot: Record<string, { title?: string; movedTo?: string }>;
  /** UUID-identity reassignment: a stable uuid whose underlying *document* was
   *  wholly replaced (different title + rewritten body). id → old/new titles and
   *  (best-effort) where the displaced old content moved to. Drives the ⚠. */
  identitySwap: Record<string, IdentitySwap>;
  /** The other side of a swap: a new doc that received content which previously
   *  lived under a different uuid. id → that previous uuid + its old identity. */
  formerUuid: Record<string, FormerUuid>;
  /** The diff-base actually resolved for this bundle (a `?base=` override
   *  reconciled against what the bundle's meta.json actually offers).
   *  Optional for back-compat with mocks built before this field existed —
   *  every real consumer should read it via `?? null`. Null outside preview
   *  mode, before meta.json resolves, and for bundles built before per-base
   *  diffs existed. */
  activeBase?: ActiveBase | null;
  /** True while a preview's diff.json has not been read yet: its empty sets
   *  then mean "not known", not "nothing changed". Absent once it has (and
   *  outside preview). */
  pending?: boolean;
}

const EMPTY: PreviewDiff = {
  added: new Set(),
  changed: new Set(),
  renumbered: {},
  retitled: {},
  retyped: {},
  reusedSlot: {},
  identitySwap: {},
  formerUuid: {},
  activeBase: null,
};

const PENDING: PreviewDiff = { ...EMPTY, pending: true };

const PreviewDiffContext = createContext<PreviewDiff>(EMPTY);

export function usePreviewDiff(): PreviewDiff {
  return useContext(PreviewDiffContext);
}

export function PreviewDiffProvider({ children }: { children: ReactNode }) {
  const { base, preview } = useDataSource();
  const { baseKey } = usePreviewView();
  const [diff, setDiff] = useState<PreviewDiff>(preview ? PENDING : EMPTY);
  useEffect(() => {
    if (!preview) return setDiff(EMPTY);
    let live = true;
    const gone = new AbortController();
    showPreviewDiff(base, baseKey, () => live, gone.signal, setDiff);
    return () => {
      live = false;
      gone.abort();
    };
  }, [base, preview, baseKey]);
  return <PreviewDiffContext.Provider value={diff}>{children}</PreviewDiffContext.Provider>;
}

function showPreviewDiff(
  base: string,
  baseKey: ReturnType<typeof usePreviewView>["baseKey"],
  live: () => boolean,
  signal: AbortSignal,
  setDiff: (next: PreviewDiff | ((now: PreviewDiff) => PreviewDiff)) => void,
) {
  fetchPreviewDiff(base, baseKey).then(async (loaded) => {
    if (!live()) return;
    if (!loaded) {
      setDiff(EMPTY);
      return;
    }
    setDiff(loaded.diff);
    const verdict = await loadIdentityVerdict(base, loaded.usedKey, { signal });
    if (live() && verdict) setDiff((now) => ({ ...now, ...verdict }));
  });
}

// ---------------------------------------------------------------------------
// Lazy per-doc patches (GET patches.json). Larger than diff.json, so it's NOT
// loaded by the eager provider above — only fetched the first time a preview
// history tab mounts (usePreviewPatch), then cached per base+key. Maps doc id
// → rendered line diff in the same DiffLine[] shape the live history uses.
// ---------------------------------------------------------------------------

const patchCache = new Map<string, Promise<Record<string, DiffLine[]>>>();

function loadPreviewPatches(base: string, key: PreviewBaseKey | null): Promise<Record<string, DiffLine[]>> {
  const cacheKey = `${base}${key ?? ""}`;
  let p = patchCache.get(cacheKey);
  if (!p) {
    const url = key ? `${base}patches.${key}.json` : `${base}patches.json`;
    p = fetch(url)
      .then((r) => {
        if (r.ok) return r.json();
        // Keyed 404 (bundle predates per-base patches, or the key is stale) —
        // fall back to the auto pair every bundle always ships.
        if (key) return fetch(`${base}patches.json`).then((r2) => (r2.ok ? r2.json() : {}));
        return {};
      })
      .catch(() => ({}));
    patchCache.set(cacheKey, p);
  }
  return p;
}

export function usePreviewPatch(nodeId: string): DiffLine[] | null {
  const { base, preview } = useDataSource();
  // Same key the diff provider resolved (an override reconciled against what
  // the bundle actually has) — read from context rather than re-resolving
  // independently, so the patch shown always matches the diff shown.
  const { activeBase } = usePreviewDiff();
  const key: PreviewBaseKey | null =
    activeBase?.key === "sky" || activeBase?.key === "repo" ? activeBase.key : null;
  const [lines, setLines] = useState<DiffLine[] | null>(null);
  useEffect(() => {
    if (!preview) {
      setLines(null);
      return;
    }
    let live = true;
    loadPreviewPatches(base, key).then((m) => {
      if (live) setLines(m[nodeId] ?? null);
    });
    return () => {
      live = false;
    };
  }, [base, preview, nodeId, key]);
  return lines;
}
