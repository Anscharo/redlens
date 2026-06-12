import { useState, useEffect, useRef, startTransition } from "react";
import { loadAtlas } from "../lib/docs";
import { loadAddresses } from "../lib/addresses";
import { loadChainState } from "../lib/chainstate";
import { loadGlossary } from "../lib/glossary";
import { setAddressMap } from "../lib/addressMap";
import { flattenTree } from "../lib/atlasHelpers";
import { type LoadedData } from "../lib/atlasHelpers";

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
  const [data, setData] = useState<LoadedData | null>(null);
  useEffect(() => {
    Promise.all([loadAtlas(), loadAddresses(), loadChainState(), loadGlossary()]).then(
      ([atlas, addresses, chainState, glossary]) => {
        setAddressMap(addresses);
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
    );
  }, []);
  return data;
}
