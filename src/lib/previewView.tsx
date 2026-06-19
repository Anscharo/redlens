import { createContext, useContext, useState, type ReactNode } from "react";

// Preview view state shared by the sidebar toggle, the sidebar tree, and the
// reader: "show only changed docs" vs "show all". Default off; only meaningful
// in preview mode.
interface PreviewView {
  onlyChanged: boolean;
  setOnlyChanged: (b: boolean) => void;
}

const PreviewViewContext = createContext<PreviewView>({ onlyChanged: false, setOnlyChanged: () => {} });

export function usePreviewView(): PreviewView {
  return useContext(PreviewViewContext);
}

export function PreviewViewProvider({ children }: { children: ReactNode }) {
  const [onlyChanged, setOnlyChanged] = useState(false);
  return <PreviewViewContext.Provider value={{ onlyChanged, setOnlyChanged }}>{children}</PreviewViewContext.Provider>;
}
