import { createContext, useContext } from "react";

// The data-source the reader/radar/etc. load from. Default = the live atlas
// (artifacts under BASE_URL). In preview mode `base` is "/api/preview/<sha>/"
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
  base: import.meta.env.BASE_URL,
  preview: null,
};

export const DataSourceContext = createContext<DataSource>(DEFAULT_SOURCE);

export function useDataSource(): DataSource {
  return useContext(DataSourceContext);
}
