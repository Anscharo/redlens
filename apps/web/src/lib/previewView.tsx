import { createContext, useContext, type ReactNode } from "react";
import { useAtlasSubset } from "./atlasSubset";
import { urlEnumList, useUrlPatch, useUrlState, type UrlCodec } from "../hooks/useUrlState";
import type { PreviewBaseKey } from "./previewMetaCopy";
import { PREVIEW_FILTER_IDS, type PreviewFilterId } from "./previewFilters";

// Preview view state shared by the sidebar filter bar, the sidebar tree, and
// the reader: "show only changed docs" vs "show all" (`subset=changed`), which
// change filters narrow it (`change=new,edited`, see previewFilters.ts; absent
// = every change), plus a `?base=sky|repo` diff-base override (absent = null =
// follow the server's automatic pick). Only meaningful in preview mode.
interface PreviewView {
  onlyChanged: boolean;
  setOnlyChanged: (b: boolean) => void;
  changeFilters: PreviewFilterId[];
  /** Turns the changed-only view on with exactly these filters ticked. */
  setChangeFilters: (next: PreviewFilterId[]) => void;
  baseKey: PreviewBaseKey | null;
  setBaseKey: (next: PreviewBaseKey | null) => void;
}

// Module-level so useUrlState's memoization (keyed on codec identity) isn't
// defeated by a fresh object every render.
const baseKeyCodec: UrlCodec<PreviewBaseKey | null> = {
  encode: (v) => (v === "sky" || v === "repo" ? v : null),
  decode: (raw) => (raw === "sky" || raw === "repo" ? raw : null),
};
const changeCodec = urlEnumList<PreviewFilterId>(PREVIEW_FILTER_IDS);

const PreviewViewContext = createContext<PreviewView>({
  onlyChanged: false,
  setOnlyChanged: () => {},
  changeFilters: [],
  setChangeFilters: () => {},
  baseKey: null,
  setBaseKey: () => {},
});

export function usePreviewView(): PreviewView {
  return useContext(PreviewViewContext);
}

export function PreviewViewProvider({ children }: { children: ReactNode }) {
  const [subset] = useAtlasSubset();
  const [changeFilters] = useUrlState("change", changeCodec);
  const patchUrl = useUrlPatch();
  const onlyChanged = subset === "changed";
  // One URL write for both params: two setters in one event undo each other
  // (see useUrlPatch). Leaving the filtered view drops its filters with it.
  const setOnlyChanged = (next: boolean) => patchUrl(next ? { subset: "changed" } : { subset: null, change: null });
  const setChangeFilters = (next: PreviewFilterId[]) => patchUrl({ subset: "changed", change: changeCodec.encode(next) });
  const [baseKey, setBaseKey] = useUrlState("base", baseKeyCodec);
  return (
    <PreviewViewContext.Provider value={{ onlyChanged, setOnlyChanged, changeFilters, setChangeFilters, baseKey, setBaseKey }}>
      {children}
    </PreviewViewContext.Provider>
  );
}
