import { useState, useEffect, useRef, useCallback, startTransition } from "react";
import { loadAtlas, loadAtlasShallow } from "../lib/docs";
import { loadAddresses } from "../lib/addresses";
import { loadChainState } from "../lib/chainstate";
import { loadGlossary } from "../lib/glossary";
import { setAddressMap } from "../lib/addressMap";
import { flattenTree } from "../lib/atlasHelpers";
import { type LoadedData } from "../lib/atlasHelpers";
import { useDataSource } from "../lib/dataSource";

/** Load any module-level cached promise (loadGraph, loadAtlas, loadDocs, etc.)
 *  and return the resolved value, or null while loading.
 *
 *  On rejection the loader's error is re-thrown during render so the nearest
 *  ErrorBoundary (App wraps every route) shows its page-level error UI — a load
 *  failure must not become a permanent "Loading…" spinner + an unhandled promise
 *  rejection. Pass `{ soft: true }` when the data is a non-load-bearing
 *  enrichment (e.g. the graph panel inside the reader): the failure is still
 *  caught (no unhandled rejection) but returns null instead of blanking the page. */
export function useLoaded<T>(loader: () => Promise<T>, opts?: { soft?: boolean }): T | null {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const ref = useRef(loader);
  const soft = opts?.soft ?? false;
  useEffect(() => {
    let live = true;
    ref.current().then(
      (v) => { if (live) setData(v); },
      (e) => { if (live) setError(e instanceof Error ? e : new Error(String(e))); },
    );
    return () => { live = false; };
  }, []);
  if (error && !soft) throw error;
  return data;
}

export interface AtlasDataState {
  /** The shallow-or-full bundle; null until docs-shallow.json (load-bearing)
   *  first lands, or if it failed and no retry has succeeded yet. */
  data: LoadedData | null;
  /** docs-shallow.json itself failed to load. `data` stays null while this is
   *  set — the blocking failure mode (there is nothing to render). Cleared
   *  optimistically on retry() and for real once shallow next resolves. */
  shallowError: Error | null;
  /** docs-deep.json (or an enrichment fetch reached through it) failed AFTER
   *  shallow succeeded. `data` still holds the rendered shallow tree
   *  (complete: false) — a non-blocking failure the reader can keep working
   *  around. Cleared optimistically on retry() and for real once the full
   *  bundle next resolves. */
  deepError: Error | null;
  /** Re-attempts whichever phase(s) haven't succeeded yet. A retry never
   *  clears already-good `data` — a deep-only retry re-requests shallow too
   *  (harmless: phase 1 below only ever fills in a null `data`), but the
   *  rendered tree stays on screen throughout. */
  retry: () => void;
}

export function useAtlasData(): AtlasDataState {
  const { base } = useDataSource();
  const [data, setData] = useState<LoadedData | null>(null);
  const [shallowError, setShallowError] = useState<Error | null>(null);
  const [deepError, setDeepError] = useState<Error | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  // Tracks the base the effect last ran for, so a bare retry (same base,
  // retryTick bumped) can be told apart from an actual data-source switch
  // (live ↔ preview) — only the latter should blow away already-rendered data.
  const prevBaseRef = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    if (prevBaseRef.current !== base) {
      prevBaseRef.current = base;
      setData(null);
      setShallowError(null);
      setDeepError(null);
    }
    // loadAtlas is load-bearing — docs must succeed for the reader to render.
    // Addresses, chain state, and glossary are enrichments; fail silently so a
    // missing artifact (e.g. no glossary.json on a partial build) doesn't block
    // the whole reader. In preview mode docs + glossary come from the preview
    // bundle (`base`); chain state is reused from main.
    const safe = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

    // Phase 1 — SHALLOW: render the full initial visible tree from docs-shallow.json
    // (depth ≤ 5, ~159 KB gz, content included) the instant it lands, before the
    // heavier docs-deep.json (depth > 5, ~663 KB gz — gated behind "view all
    // descendants", so off the first-paint path). Enrichments are null until phase 2;
    // `complete: false` marks the tree as still-loading. See docs/plans/docs-split.md.
    loadAtlasShallow(base)
      .then((atlas) => {
        if (!live) return;
        setShallowError(null);
        startTransition(() => {
          setData(
            (prev) =>
              prev ?? {
                atlas,
                flatNodes: flattenTree(atlas.byParent),
                addresses: null,
                chainState: null,
                glossary: null,
                complete: false,
              },
          );
        });
      })
      .catch((err) => {
        // Load-bearing: without shallow there's nothing to render — surface it
        // instead of leaving the caller in an eternal loading state with no
        // way out (see AtlasView). A retry that re-requests shallow only
        // because deep alone had failed lands here too if it happens to fail
        // this time; `data` from the earlier successful attempt is untouched
        // above (phase 1 never clears it), so this doesn't clobber a working view.
        if (!live) return;
        setShallowError(err instanceof Error ? err : new Error(String(err)));
      });

    // Phase 2 — FULL: docs-deep merged in (all depths) + enrichments. Replaces the
    // shallow set; `complete: true` lets the reader resolve deep-linked deep nodes.
    loadAtlas(base)
      .then((atlas) =>
        Promise.all([safe(loadAddresses(base)), safe(loadChainState()), safe(loadGlossary(base))]).then(
          ([addresses, chainState, glossary]) => {
            if (!live) return;
            if (addresses) setAddressMap(addresses);
            setDeepError(null);
            startTransition(() => {
              setData({
                atlas,
                flatNodes: flattenTree(atlas.byParent),
                addresses,
                chainState,
                glossary,
                complete: true,
              });
            });
          },
        ),
      )
      // A stale-sha rejection already triggers a force-forward reload
      // (handledStaleMessage in the worker error path — that promise never
      // settles, so this .catch never fires for it). Any other deep-load
      // failure keeps the shallow-only view (data.complete stays false, never
      // destroyed — see lib/docs.ts spawn()) and is surfaced as a non-blocking
      // error the caller can retry() instead of an eternal spinner.
      .catch((err) => {
        if (!live) return;
        setDeepError(err instanceof Error ? err : new Error(String(err)));
      });
    return () => {
      live = false;
    };
  }, [base, retryTick]);

  const retry = useCallback(() => {
    // Optimistic clear: an in-flight retry reads as "loading" rather than
    // holding the stale error on screen until the new attempt settles.
    setShallowError(null);
    setDeepError(null);
    setRetryTick((t) => t + 1);
  }, []);

  return { data, shallowError, deepError, retry };
}
