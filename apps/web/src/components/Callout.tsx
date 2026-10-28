import type { ComponentProps } from "react";

/** An explanation of what a section shows, set apart from the data it explains (`.callout` in index.css). */
export function Callout({ className, ...props }: ComponentProps<"aside">) {
  return <aside className={className ? `callout ${className}` : "callout"} {...props} />;
}
