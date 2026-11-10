// The "on-chain update pending" mark (src/lib/pauPending.ts): a clock where a
// mismatch would show ✗, at the text's size and colour. The caller sets the
// colour, grey wherever it appears, because a pending change is not a defect.
import type { ComponentProps } from "react";

export type ClockGlyphProps = ComponentProps<"svg"> & { size?: number };

export function ClockGlyph({ size = 10, style, ...props }: ClockGlyphProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-slot="clock-glyph"
      style={{ display: "inline", verticalAlign: "-1px", ...style }}
      {...props}
    >
      <circle cx="8" cy="8" r="6.8" />
      <path d="M8 4.4V8l2.4 1.6" />
    </svg>
  );
}
