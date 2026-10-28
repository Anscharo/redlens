import type { ComponentProps } from "react";

export type SearchBarProps = ComponentProps<"div">;

/**
 * The search row of the app header: the field and the controls beside it. A
 * row of its own on phones, beside the nav from `sm` up.
 */
export function SearchBar(props: SearchBarProps) {
  return <div className="order-3 sm:order-2 w-full sm:flex-1 sm:max-w-[680px] flex items-stretch gap-2 min-w-0" {...props} />;
}

export type SearchFieldProps = ComponentProps<"div">;

/**
 * The bordered box around the search icon, scope chip, input and clear
 * button. A `data-scope` other than `atlas` tints its border.
 */
export function SearchField(props: SearchFieldProps) {
  return <div className="search-input-wrap w-full flex items-center rounded border min-w-0" {...props} />;
}

export type SearchScopeChipProps = ComponentProps<"span">;

/** The label naming what the field filters outside the atlas. Decorative: the input's own label says it. */
export function SearchScopeChip(props: SearchScopeChipProps) {
  return <span className="scope-chip ml-2 shrink-0" aria-hidden="true" {...props} />;
}
