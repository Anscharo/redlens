import { useState, useEffect, useRef, startTransition } from "react";
import { loadAtlas, loadAtlasTree } from "../lib/docs";
import { loadAddresses } from "../lib/addresses";
import { loadChainState } from "../lib/chainstate";
import { loadGlossary } from "../lib/glossary";
import { setAddressMap } from "../lib/addressMap";
import { flattenTree } from "../lib/atlasHelpers";
import { type LoadedData } from "../lib/atlasHelpers";
import { useDataSource } from "../lib/dataSource";

/** Load any module-level cached promise (loadGraph, loadAtlas, loadDocs, etc.)
 *  and return the resolved value, or null while loading. */
export function useLoaded<T>(loader: () => Promise<T>): T | null {
  const [data, setData] = useState<T | null>(null);
  const ref = useRef(loader);
  useEffect(() => {
    ref.current().then(setData);
  }, []);
  return data;
}

export function useAtlasData(): LoadedData | null {
  const { base } = useDataSource();
  const [data, setData] = useState<LoadedData | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
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
    loadAtlasTree(base)
      .then((atlas) => {
        if (!live) return;
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
      .catch(() => {});

    // Phase 2 — FULL: docs-deep merged in (all depths) + enrichments. Replaces the
    // shallow set; `complete: true` lets the reader resolve deep-linked deep nodes.
    loadAtlas(base)
      .then((atlas) =>
        Promise.all([safe(loadAddresses(base)), safe(loadChainState()), safe(loadGlossary(base))]).then(
          ([addresses, chainState, glossary]) => {
            if (!live) return;
            if (addresses) setAddressMap(addresses);
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
      // A stale-sha rejection already triggers a force-forward reload (handledStaleMessage
      // in the worker error path); any other deep-load failure stays on the shallow-only
      // view rather than leaking an unhandled rejection and pinning `complete: false`.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [base]);
  return data;
}
