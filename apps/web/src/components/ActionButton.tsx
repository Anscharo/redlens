import type { ComponentProps } from "react";

const BUTTON = "mono text-xs px-3 py-1.5 rounded border transition-colors hover:bg-[var(--hover)]";

// A card's bordered text action (Open, Rename, Delete …), tinted by `color`.
export function ActionButton({ color, className, ...props }: ComponentProps<"button"> & { color: string }) {
  return <button type="button" {...props} className={className ? `${BUTTON} ${className}` : BUTTON} style={{ borderColor: "var(--border)", color }} />;
}
