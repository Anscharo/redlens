import type { CSSProperties } from "react";

// Checkerboard for alpha previews: `fg` squares over a `bg` fill, both CSS colors.
export function checkerBg(fg: string, bg: string): CSSProperties {
  return {
    backgroundImage: `linear-gradient(45deg, ${fg} 25%, transparent 25%), linear-gradient(-45deg, ${fg} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${fg} 75%), linear-gradient(-45deg, transparent 75%, ${fg} 75%)`,
    backgroundSize: "12px 12px",
    backgroundPosition: "0 0, 0 6px, 6px -6px, -6px 0",
    backgroundColor: bg,
  };
}
