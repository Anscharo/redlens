import { createContext, useContext } from "react";
import type { SubtreeVisualState } from "./subtreeState";

interface AtlasActions {
  navigate: (id: string) => void;
  toggle: (id: string) => void;
  splitNavigate: (id: string) => void;
  /** Recursive expand/collapse of a node + all descendants. Only the main
   *  reader provides this; rows hide the affordance when it's absent. */
  expandAll?: (id: string, expand: boolean) => void;
  /** Hide/reveal every descendant of a node without removing the node itself. */
  hideSubtree?: (id: string, hidden: boolean, options?: { restore?: boolean }) => void;
  /** State-machine target for the recursive double-chevron control. */
  setSubtreeVisualState?: (id: string, state: SubtreeVisualState, options?: { restore?: boolean }) => void;
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
