import { createContext, useContext } from "react";

interface AtlasActions {
  navigate: (id: string) => void;
  toggle: (id: string) => void;
  splitNavigate: (id: string) => void;
}

export const AtlasActionsContext = createContext<AtlasActions | null>(null);

export function useAtlasActions(): AtlasActions {
  const ctx = useContext(AtlasActionsContext);
  if (!ctx) throw new Error("useAtlasActions must be used within AtlasActionsContext.Provider");
  return ctx;
}
