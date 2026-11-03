import type { CSSProperties } from "react";
import { useFilterHides } from "../../lib/atlasFilter";
import { useAtlasSubset } from "../../lib/atlasSubset";

const BAR_STYLE: CSSProperties = { borderBottom: "1px solid var(--border)" };

/** Says so when the URL's doc is one the subset filter hides. Links never land
 *  the reader there (they open such a doc in the comparison pane), but a shared
 *  link, back/forward, or switching a filter on while reading still can, and
 *  the reader then has no row for the doc its breadcrumbs name. */
export function FilteredOutNotice({ id }: { id: string }) {
  const filterHides = useFilterHides();
  const [, setSubset] = useAtlasSubset();
  if (!id || !filterHides(id)) return null;
  return (
    <div role="status" className="flex items-center gap-2 px-3 py-1 text-xs mono text-tan-3" style={BAR_STYLE}>
      <p>This document is filtered out of the current view.</p>
      <button type="button" onClick={() => setSubset("all")} className="text-xs mono text-accent hover:underline">
        show all
      </button>
    </div>
  );
}
