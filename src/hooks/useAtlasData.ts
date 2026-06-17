import { useState, useEffect, useRef, startTransition } from "react";
import { loadAtlas } from "../lib/docs";
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
    // bundle (`base`); addresses + chain state are reused from main.
    const safe = <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
    loadAtlas(base).then((atlas) =>
      Promise.all([safe(loadAddresses()), safe(loadChainState()), safe(loadGlossary(base))]).then(
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
            });
          });
        },
      ),
    );
    return () => {
      live = false;
    };
  }, [base]);
  return data;
}
