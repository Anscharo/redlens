import { memo } from "react";
import { chicletColor } from "../lib/depth";

interface Props {
  parts: string[];
  depths: number[];
  // Optional per-chiclet column span (NR-X dash stretches across several columns).
  slots?: number[];
  // Optional per-chiclet CSS gradient (NR-X dash line bridges parent → number colour).
  gradients?: (string | undefined)[];
}

export const DocNoChiclets = memo(function DocNoChiclets({ parts, depths, slots, gradients }: Props) {
  return (
    <span className="atlas-chiclets">
      {parts.map((seg, i) => {
        const span = slots?.[i] ?? 1;
        const grad = gradients?.[i];
        if (seg === "" && !grad && span <= 1)
          // Indent spacer (NR-X nodes) — occupies a chiclet's width, no glyph or underline.
          return <span key={`${i}:spacer`} className="atlas-chiclet atlas-chiclet-spacer" />;
        const style = { ["--c" as string]: chicletColor(depths[i]) } as React.CSSProperties;
        if (span > 1) (style as Record<string, unknown>)["--slots"] = span;
        if (grad) (style as Record<string, unknown>)["--grad"] = grad;
        return (
          <span
            key={`${i}:${seg}`}
            // Multi-char segments (`var1`, double-digit numbers) size to their content;
            // `span > 1` chiclets (NR-X dash) stretch across that many grid columns;
            // `grad` paints the chiclet's line + glyph with a gradient.
            className={`atlas-chiclet${seg.length > 1 ? " atlas-chiclet-wide" : ""}${span > 1 ? " atlas-chiclet-span" : ""}${grad ? " atlas-chiclet-grad" : ""}`}
            style={style}
          >
            {seg}
          </span>
        );
      })}
    </span>
  );
});
