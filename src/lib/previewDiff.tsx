import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useDataSource } from "./dataSource";

// Doc ids the preview adds / changes vs current main (from GET diff.json).
// Drives the green new/changed redline indicators. Empty (and no fetch) outside
// preview mode, so the default context works everywhere without a provider.
export interface PreviewDiff {
  added: Set<string>;
  changed: Set<string>;
}

const EMPTY: PreviewDiff = { added: new Set(), changed: new Set() };

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
        setDiff({ added: new Set<string>(d.added ?? []), changed: new Set<string>(d.changed ?? []) });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [base, preview]);
  return <PreviewDiffContext.Provider value={diff}>{children}</PreviewDiffContext.Provider>;
}
