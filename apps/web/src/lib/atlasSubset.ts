import { useUrlState, urlEnum } from "../hooks/useUrlState";

export type AtlasSubset = "all" | "changed" | "selected";

const subsetCodec = urlEnum<AtlasSubset>("all", ["all", "changed", "selected"] as const);

// Shared URL state for atlas subset filters. Preview currently uses
// `subset=changed`; live selection uses `subset=selected`. Keeping one general
// param leaves room for selection in preview without minting another URL shape.
export function useAtlasSubset() {
  return useUrlState("subset", subsetCodec);
}
