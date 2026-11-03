import { useFilterHides } from "../../lib/atlasFilter";
import { useAtlasSubset } from "../../lib/atlasSubset";
import { NoticeBar, NOTICE_BAR_STYLE } from "./AtlasLoadStates";

const CLASS_NAME = "flex items-center gap-2 px-3 py-1 text-xs mono text-tan-3";

/** Says so when the URL's doc is one the subset filter hides. Links never land
 *  the reader there (see hiddenTargetHref), but a shared link, back/forward, or
 *  switching a filter on while reading still can, and the reader then has no
 *  row for the doc its breadcrumbs name. */
export function FilteredOutNotice({ id }: { id: string }) {
  const filterHides = useFilterHides();
  const [, setSubset] = useAtlasSubset();
  if (!id || !filterHides(id)) return null;
  const message = "This document is filtered out of the current view.";
  return (
    <NoticeBar role="status" className={CLASS_NAME} style={NOTICE_BAR_STYLE} message={message} action="show all" onAction={() => setSubset("all")} />
  );
}
