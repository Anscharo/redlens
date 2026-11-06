import { useRef, type ComponentProps } from "react";
import { useDataSource } from "../../lib/dataSource";
import { usePreviewView } from "../../lib/previewView";
import { usePreviewDiff } from "../../lib/previewDiff";
import { describeFilters, filterPreviewDocs } from "../../lib/previewFilters";
import { track } from "../../lib/analytics";
import { useDismissiblePopover } from "../chat/useLightDismiss";
import { TREE_TOGGLE_BAR_CLASS, TREE_TOGGLE_PILL_CLASS, togglePillStyle, treeToggleBarStyle } from "../tree/togglePill";
import { PreviewFilterTrigger } from "./PreviewFilterTrigger";
import { PreviewFilterMenu } from "./PreviewFilterMenu";

const MENU_ID = "preview-filter-menu";

// Sits above the tree in preview mode: "All", then a Filter button whose menu
// picks which changes to show (previewFilters.ts), then × to clear. The view is
// shared state, so it filters both this sidebar AND the reader area. The menu
// hangs off the whole bar, so it spans the sidebar's width.
export function PreviewTreeToggle() {
  const { preview } = useDataSource();
  const { onlyChanged, setOnlyChanged, changeFilters } = usePreviewView();
  const diff = usePreviewDiff();
  const barRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useDismissiblePopover(barRef, { claimEscape: true });
  if (!preview) return null;
  const changedCount = diff.added.size + diff.changed.size;

  const showAll = (via: "all" | "clear") => {
    track("preview_view_toggle", { view: "all", changed_count: changedCount, via });
    setOnlyChanged(false);
    setOpen(false);
  };

  return (
    <div ref={barRef} className={TREE_TOGGLE_BAR_CLASS} style={treeToggleBarStyle(onlyChanged)}>
      <button
        type="button"
        className={`${TREE_TOGGLE_PILL_CLASS} shrink-0`}
        style={togglePillStyle(!onlyChanged, "var(--tan)")}
        onClick={() => showAll("all")}
      >
        All
      </button>
      <PreviewFilterTrigger
        active={onlyChanged}
        label={onlyChanged ? describeFilters(changeFilters) : "Filter"}
        count={onlyChanged ? filterPreviewDocs(diff, changeFilters).size : null}
        open={open}
        menuId={MENU_ID}
        onClick={() => setOpen((v) => !v)}
      />
      {onlyChanged && <ClearFilterButton onClick={() => showAll("clear")} />}
      {open && <PreviewFilterMenu id={MENU_ID} onPicked={() => setOpen(false)} />}
    </div>
  );
}

function ClearFilterButton(props: Omit<ComponentProps<"button">, "children">) {
  return (
    <button type="button" className="px-1 py-0.5 rounded text-tan-3 hover:text-tan shrink-0" title="Clear filter" aria-label="Clear filter" {...props}>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
        <path d="M1 1 L9 9 M9 1 L1 9" />
      </svg>
    </button>
  );
}
