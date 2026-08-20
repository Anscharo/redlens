import { createContext, useContext } from "react";
import { liveAtlasBase } from "./atlasBase";

// The data-source the reader/radar/etc. load from. Default = the live atlas,
// served from immutable per-sha URLs ("/api/atlas/<sha>/", from the sha the
// server injected into the HTML). In preview mode `base` is "/api/preview/<sha>/"
// and `preview` carries the id/sha for the banner. Every loader reads `base`
// from here, so the SAME components render either source — no separate views.
export interface PreviewInfo {
  id: string;
  sha: string;
}

export interface DataSource {
  base: string;
  preview: PreviewInfo | null;
}

export const DEFAULT_SOURCE: DataSource = {
  base: liveAtlasBase(),
  preview: null,
};

export const DataSourceContext = createContext<DataSource>(DEFAULT_SOURCE);

export function useDataSource(): DataSource {
  return useContext(DataSourceContext);
}
