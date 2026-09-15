import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useDataSource } from "./dataSource";
import { usePreviewView } from "./previewView";
import type { ActiveBase, PreviewBaseKey, PreviewBases } from "./previewMetaCopy";
import type { DiffLine } from "@/lib/history";

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
  /** Changed docs whose title differs from the live atlas (title-only or
   *  title+content edits). id → [live title, preview title]. */
  retitled: Record<string, [string, string]>;
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
}

const EMPTY: PreviewDiff = {
  added: new Set(),
  changed: new Set(),
  renumbered: {},
  retitled: {},
  reusedSlot: {},
  identitySwap: {},
  formerUuid: {},
  activeBase: null,
};

const PreviewDiffContext = createContext<PreviewDiff>(EMPTY);

export function usePreviewDiff(): PreviewDiff {
  return useContext(PreviewDiffContext);
}

/** Reconcile a `?base=` override against what the bundle's meta.json actually
 *  offers: an override wins when that candidate exists; otherwise (including
 *  entirely old bundles with no `bases`) fall back to the server's automatic
 *  pick, which is what plain diff.json/patches.json always mirror. */
function resolveBase(
  baseKey: PreviewBaseKey | null,
  bases: PreviewBases | undefined,
): { fetchKey: PreviewBaseKey | null; activeBase: ActiveBase | null } {
  if (!bases) return { fetchKey: null, activeBase: null };

  const requested = baseKey ?? bases.auto;
  if ((requested === "sky" || requested === "repo") && bases[requested]) {
    const cand = bases[requested]!;
    return {
      fetchKey: requested,
      activeBase: { key: requested, repo: cand.repo, ref: cand.ref, auto: baseKey === null || baseKey === bases.auto },
    };
  }

  if (bases.auto === "sky" && bases.sky) {
    return { fetchKey: null, activeBase: { key: "sky", repo: bases.sky.repo, ref: bases.sky.ref, auto: true } };
  }
  if (bases.auto === "repo" && bases.repo) {
    return { fetchKey: null, activeBase: { key: "repo", repo: bases.repo.repo, ref: bases.repo.ref, auto: true } };
  }
  return { fetchKey: null, activeBase: { key: "live-main", auto: true } };
}

export function PreviewDiffProvider({ children }: { children: ReactNode }) {
  const { base, preview } = useDataSource();
  const { baseKey } = usePreviewView();
  const [diff, setDiff] = useState<PreviewDiff>(EMPTY);
  useEffect(() => {
    if (!preview) {
      setDiff(EMPTY);
      return;
    }
    let live = true;
    async function run() {
      const meta: { bases?: PreviewBases } | null = await fetch(`${base}meta.json`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!live) return;
      const { fetchKey, activeBase } = resolveBase(baseKey, meta?.bases);
      const url = fetchKey ? `${base}diff.${fetchKey}.json` : `${base}diff.json`;
      const d = await fetch(url)
        .then((r) => {
          if (r.ok) return r.json();
          if (fetchKey) return fetch(`${base}diff.json`).then((r2) => (r2.ok ? r2.json() : null));
          return null;
        })
        .catch(() => null);
      if (!live || !d) return;
      setDiff({
        added: new Set<string>(d.added ?? []),
        changed: new Set<string>(d.changed ?? []),
        renumbered: d.renumbered ?? {},
        // Absent on bundles built before retitle detection shipped.
        retitled: d.retitled ?? {},
        // Older bundles shipped reusedSlot as a bare id array — normalize.
        reusedSlot: Array.isArray(d.reusedSlot)
          ? Object.fromEntries((d.reusedSlot as string[]).map((id) => [id, {}]))
          : (d.reusedSlot ?? {}),
        // Both absent on bundles built before identity-swap detection shipped.
        identitySwap: d.identitySwap ?? {},
        formerUuid: d.formerUuid ?? {},
        activeBase,
      });
    }
    run();
    return () => {
      live = false;
    };
  }, [base, preview, baseKey]);
  return <PreviewDiffContext.Provider value={diff}>{children}</PreviewDiffContext.Provider>;
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
