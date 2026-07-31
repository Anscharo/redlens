import { createContext, useContext } from "react";

interface AtlasActions {
  navigate: (id: string) => void;
  toggle: (id: string) => void;
  splitNavigate: (id: string) => void;
  /** The » click: advances a node's rung to the next pendulum position (see
   *  subtreeState.ts). Only the main reader provides this; rows hide the
   *  affordance when it's absent. */
  pendulum?: (id: string) => void;
  /** Select a node + all its descendants at once (shift-click on the expand
   *  toggle). Only the main reader provides it. */
  selectSubtree?: (id: string) => void;
}

export const AtlasActionsContext = createContext<AtlasActions | null>(null);

export function useAtlasActions(): AtlasActions {
  const ctx = useContext(AtlasActionsContext);
  if (!ctx) throw new Error("useAtlasActions must be used within AtlasActionsContext.Provider");
  return ctx;
}
