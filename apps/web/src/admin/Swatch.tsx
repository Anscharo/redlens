import { forwardRef } from "react";
import type { ContrastLevel } from "./contrast";
import type { PaletteToken } from "./palette-tokens";

const BADGE_COLOR: Record<ContrastLevel, string> = {
  AAA: "var(--gray)",
  AA: "var(--terminal-green)",
  "AA Large": "var(--depth-2)",
  Fail: "var(--error-text)",
};

interface SwatchProps {
  token: PaletteToken;
  value: string;
  isOverridden: boolean;
  onClick: () => void;
  contrastBadge?: { ratio: number; level: ContrastLevel };
}

// Checkerboard pattern for alpha previews.
const CHECKER_BG: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg, var(--surface) 25%, transparent 25%), linear-gradient(-45deg, var(--surface) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--surface) 75%), linear-gradient(-45deg, transparent 75%, var(--surface) 75%)",
  backgroundSize: "12px 12px",
  backgroundPosition: "0 0, 0 6px, 6px -6px, -6px 0",
  backgroundColor: "var(--bg-deep)",
};

export const Swatch = forwardRef<HTMLButtonElement, SwatchProps>(function Swatch(
  { token, value, isOverridden, onClick, contrastBadge },
  ref,
) {
  return (
    <button
      ref={ref}
      onClick={onClick}
      aria-label={`Edit ${token.label} (--${token.name}), currently ${value}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: 8,
        background: "var(--surface)",
        border: `1px solid ${isOverridden ? "var(--accent)" : "var(--border)"}`,
        borderRadius: 6,
        cursor: "pointer",
        textAlign: "left",
        position: "relative",
        minWidth: 0,
      }}
    >
      {isOverridden && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--accent)",
          }}
        />
      )}
      <span
        className="mono"
        style={{
          fontSize: 9,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--tan-3)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {token.label}
      </span>
      <div
        style={{
          ...(token.alpha ? CHECKER_BG : {}),
          height: 56,
          borderRadius: 4,
          border: "1px solid var(--border)",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: value,
          }}
        />
      </div>
      <span
        className="mono"
        style={{
          fontSize: 9,
          color: isOverridden ? "var(--accent)" : "var(--tan-3)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        title={`--${token.name}: ${value}`}
      >
        {value}
      </span>
      {contrastBadge && (
        <span
          className="mono"
          style={{ fontSize: 9, fontWeight: 700, color: BADGE_COLOR[contrastBadge.level] }}
          title={`Contrast ratio: ${contrastBadge.ratio.toFixed(2)} (worst-case bg)`}
        >
          Contrast: {contrastBadge.ratio.toFixed(1)}{" "}
          {contrastBadge.level === "AA Large" ? "BB" : contrastBadge.level}
        </span>
      )}
    </button>
  );
});
