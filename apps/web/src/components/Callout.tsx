import type { ComponentProps } from "react";

/**
 * An explanation of what a section shows, set apart from the data it explains
 * (`.callout` in index.css). A note, not an `<aside>`: several on one page
 * would each be an unnamed complementary landmark.
 */
export function Callout({ className, ...props }: ComponentProps<"div">) {
  return <div role="note" className={className ? `callout ${className}` : "callout"} {...props} />;
}
