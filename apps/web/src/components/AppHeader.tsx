import type { ComponentProps } from "react";

export type AppHeaderProps = ComponentProps<"header">;

/**
 * The sticky bar at the top of every page. Its children (home link, nav,
 * search) are siblings in one wrapping row; each sets its own `order`, so on
 * phones the search drops to a row of its own under the other two.
 */
export function AppHeader(props: AppHeaderProps) {
  return (
    <header
      className="search-header shrink-0 px-3 sm:px-4 pt-3 pb-2 border-b sticky top-0 z-20 flex flex-wrap items-center gap-x-2 gap-y-2"
      style={{ background: "var(--bg)" }}
      {...props}
    />
  );
}
