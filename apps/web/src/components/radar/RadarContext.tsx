import { createContext, useContext, type ReactNode } from "react";
import type { AtlasNode } from "@/types";

interface RadarContextValue {
  docs: Record<string, AtlasNode>;
}

const RadarCtx = createContext<RadarContextValue | null>(null);

export function RadarProvider({ value, children }: { value: RadarContextValue; children: ReactNode }) {
  return <RadarCtx.Provider value={value}>{children}</RadarCtx.Provider>;
}

export function useRadar(): RadarContextValue {
  const v = useContext(RadarCtx);
  if (!v) throw new Error("useRadar must be used inside <RadarProvider>");
  return v;
}
