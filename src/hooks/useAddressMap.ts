import { useEffect, useState } from "react";
import { loadAddresses } from "../lib/addresses";
import { setAddressMap } from "../lib/addressMap";
import type { AddressInfo } from "../types";

/** The merged address map as React state, plus the shared-singleton hydration
 *  that `useHydrateAddressMap` performs.
 *
 *  Two consumers, two needs. The rehypeEthAddresses plugin runs outside the
 *  component tree and reads the imperative singleton, so hydrating that is
 *  enough for it. A component that resolves explorer URLs during render cannot
 *  use the singleton: it is populated asynchronously and writing to it triggers
 *  no re-render, so the first paint would keep whatever URL it guessed before
 *  the fetch landed. Returning state fixes that — the component re-renders with
 *  the curated URLs once they arrive. */
export function useAddressMap(): Record<string, AddressInfo> {
  const [map, setMap] = useState<Record<string, AddressInfo>>({});
  useEffect(() => {
    let alive = true;
    loadAddresses()
      .then((m) => {
        if (!alive) return;
        setMap(m);
        setAddressMap(m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return map;
}
