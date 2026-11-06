import type { ComponentProps } from "react";
import { TREE_TOGGLE_PILL_CLASS, togglePillStyle } from "../tree/togglePill";

interface PreviewFilterTriggerProps extends Omit<ComponentProps<"button">, "children"> {
  active: boolean;
  /** "Filter" when nothing is filtered, else what the filter keeps. */
  label: string;
  /** Docs the filter keeps; null when nothing is filtered. */
  count: number | null;
  open: boolean;
  menuId: string;
}

/** The button that opens the preview filter menu. The label yields first
 *  (truncates) when the sidebar is narrow; the count and caret stay. */
export function PreviewFilterTrigger({ active, label, count, open, menuId, ...props }: PreviewFilterTriggerProps) {
  return (
    <button
      type="button"
      className={`${TREE_TOGGLE_PILL_CLASS} flex items-center gap-1.5 min-w-0`}
      style={togglePillStyle(active, "var(--tan)")}
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      data-state={open ? "open" : "closed"}
      title={active ? `Filter: ${label}` : "Filter which changes the tree and reader show"}
      {...props}
    >
      <FunnelIcon />
      <span className="truncate min-w-0">{label}</span>
      {count !== null && <span className="shrink-0">· {count}</span>}
      <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true" className="shrink-0">
        <path d={open ? "M1 5.5 L4 2.5 L7 5.5" : "M1 2.5 L4 5.5 L7 2.5"} />
      </svg>
    </button>
  );
}

function FunnelIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true" className="shrink-0">
      <path d="M1 1.5 h9 l-3.5 4 v3.5 l-2 1 v-4.5 z" strokeLinejoin="round" />
    </svg>
  );
}
