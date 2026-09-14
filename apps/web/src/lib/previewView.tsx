import { createContext, useContext, type ReactNode } from "react";
import { useAtlasSubset } from "./atlasSubset";
import { useUrlState, type UrlCodec } from "../hooks/useUrlState";
import type { PreviewBaseKey } from "./previewMetaCopy";

// Preview view state shared by the sidebar toggle, the sidebar tree, and the
// reader: "show only changed docs" vs "show all" (`subset=changed`), plus a
// `?base=sky|repo` diff-base override (absent = null = follow the server's
// automatic pick). Only meaningful in preview mode.
interface PreviewView {
  onlyChanged: boolean;
  setOnlyChanged: (b: boolean) => void;
  baseKey: PreviewBaseKey | null;
  setBaseKey: (next: PreviewBaseKey | null) => void;
}

// Module-level so useUrlState's memoization (keyed on codec identity) isn't
// defeated by a fresh object every render.
const baseKeyCodec: UrlCodec<PreviewBaseKey | null> = {
  encode: (v) => (v === "sky" || v === "repo" ? v : null),
  decode: (raw) => (raw === "sky" || raw === "repo" ? raw : null),
};

const PreviewViewContext = createContext<PreviewView>({
  onlyChanged: false,
  setOnlyChanged: () => {},
  baseKey: null,
  setBaseKey: () => {},
});

export function usePreviewView(): PreviewView {
  return useContext(PreviewViewContext);
}

export function PreviewViewProvider({ children }: { children: ReactNode }) {
  const [subset, setSubset] = useAtlasSubset();
  const onlyChanged = subset === "changed";
  const setOnlyChanged = (next: boolean) => setSubset(next ? "changed" : "all");
  const [baseKey, setBaseKey] = useUrlState("base", baseKeyCodec);
  return (
    <PreviewViewContext.Provider value={{ onlyChanged, setOnlyChanged, baseKey, setBaseKey }}>
      {children}
    </PreviewViewContext.Provider>
  );
}
