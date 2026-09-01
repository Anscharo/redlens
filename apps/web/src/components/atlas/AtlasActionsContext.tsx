import { createContext, useContext } from "react";

interface AtlasActions {
  navigate: (id: string) => void;
  toggle: (id: string) => void;
  splitNavigate: (id: string) => void;
  /** The » click: advances a node's rung to the next pendulum position, or to
   *  the reversed one when alt is held (see subtreeState.ts). Only the main
   *  reader provides this; rows hide the affordance when it's absent. */
  pendulum?: (id: string, opts?: { reverse?: boolean }) => void;
  /** Select a node + all its descendants at once (shift-click on the row's
   *  selection checkbox). Only the main reader provides it. */
  selectSubtree?: (id: string) => void;
  /** doc_no → uuid, for the one place a row knows a doc by NUMBER rather than
   *  id: an annotation's "Annotates A.2.8" label, which links to its target.
   *  The map identity only changes when the atlas bundle does — the same moment
   *  every row's `entry` changes — so putting it here costs no extra renders.
   *  Optional: without it the label degrades to plain text. */
  docNoToId?: Map<string, string>;
}

export const AtlasActionsContext = createContext<AtlasActions | null>(null);

export function useAtlasActions(): AtlasActions {
  const ctx = useContext(AtlasActionsContext);
  if (!ctx) throw new Error("useAtlasActions must be used within AtlasActionsContext.Provider");
  return ctx;
}
