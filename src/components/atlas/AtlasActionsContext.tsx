import { createContext, useContext } from "react";

interface AtlasActions {
  navigate: (id: string) => void;
  toggle: (id: string) => void;
  splitNavigate: (id: string) => void;
  /** Recursive expand/collapse of a node + all descendants. Only the main
   *  reader provides this; rows hide the affordance when it's absent. */
  expandAll?: (id: string, expand: boolean) => void;
}

export const AtlasActionsContext = createContext<AtlasActions | null>(null);

export function useAtlasActions(): AtlasActions {
  const ctx = useContext(AtlasActionsContext);
  if (!ctx) throw new Error("useAtlasActions must be used within AtlasActionsContext.Provider");
  return ctx;
}
