import type { ComponentProps } from "react";
import { useSearchCombobox } from "./searchComboboxContext";

export type SearchClearProps = ComponentProps<"button">;

/**
 * The × that empties the search field. It keeps its place while the field is
 * empty (`data-state="hidden"`, invisible) so the field does not shift as the
 * reader types.
 */
export function SearchClear(props: SearchClearProps) {
  const { query } = useSearchCombobox();
  return (
    <button
      type="button"
      aria-label="Clear search"
      data-state={query ? "visible" : "hidden"}
      className="search-clear mr-2 shrink-0 w-5 h-5 flex items-center justify-center rounded text-lg leading-none"
      style={{ color: "var(--gray)" }}
      {...props}
    >
      ×
    </button>
  );
}
