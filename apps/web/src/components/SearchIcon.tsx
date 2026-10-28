import type { ComponentProps } from "react";

export type SearchIconProps = ComponentProps<"svg">;

/** The magnifier at the start of the search field. Decorative: the input carries the label. */
export function SearchIcon(props: SearchIconProps) {
  return (
    <svg
      className="shrink-0 ml-3 w-4 h-4 pointer-events-none"
      style={{ color: "var(--gray)" }}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      viewBox="0 0 24 24"
      aria-hidden="true"
      {...props}
    >
      <circle cx={11} cy={11} r={8} />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}
