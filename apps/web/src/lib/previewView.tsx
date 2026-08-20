import { createContext, useContext, type ReactNode } from "react";
import { useAtlasSubset } from "./atlasSubset";

// Preview view state shared by the sidebar toggle, the sidebar tree, and the
// reader: "show only changed docs" vs "show all". URL-synced as
// `subset=changed`; only meaningful in preview mode.
interface PreviewView {
  onlyChanged: boolean;
  setOnlyChanged: (b: boolean) => void;
}

const PreviewViewContext = createContext<PreviewView>({ onlyChanged: false, setOnlyChanged: () => {} });

export function usePreviewView(): PreviewView {
  return useContext(PreviewViewContext);
}

export function PreviewViewProvider({ children }: { children: ReactNode }) {
  const [subset, setSubset] = useAtlasSubset();
  const onlyChanged = subset === "changed";
  const setOnlyChanged = (next: boolean) => setSubset(next ? "changed" : "all");
  return <PreviewViewContext.Provider value={{ onlyChanged, setOnlyChanged }}>{children}</PreviewViewContext.Provider>;
}
