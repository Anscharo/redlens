import { forwardRef } from "react";
import type { ContrastLevel } from "./contrast";
import { checkerBg } from "./checkerBg";
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

const CHECKER_BG = checkerBg("var(--surface)", "var(--bg-deep)");

const BUTTON_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: 8,
  background: "var(--surface)",
  borderRadius: 6,
  cursor: "pointer",
  textAlign: "left",
  position: "relative",
  minWidth: 0,
};

const OVERRIDE_DOT_STYLE: React.CSSProperties = {
  position: "absolute",
  top: 6,
  right: 6,
  width: 6,
  height: 6,
  borderRadius: "50%",
  background: "var(--accent)",
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--tan-3)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const PREVIEW_STYLE: React.CSSProperties = {
  height: 56,
  borderRadius: 4,
  border: "1px solid var(--border)",
  position: "relative",
  overflow: "hidden",
};

const VALUE_STYLE: React.CSSProperties = {
  fontSize: 9,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
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
        ...BUTTON_STYLE,
        border: `1px solid ${isOverridden ? "var(--accent)" : "var(--border)"}`,
      }}
    >
      {isOverridden && (
        <span
          aria-hidden
          style={OVERRIDE_DOT_STYLE}
        />
      )}
      <span
        className="mono"
        style={LABEL_STYLE}
      >
        {token.label}
      </span>
      <div
        style={{ ...(token.alpha ? CHECKER_BG : {}), ...PREVIEW_STYLE }}
      >
        <div style={{ position: "absolute", inset: 0, background: value }} />
      </div>
      <span
        className="mono"
        style={{ ...VALUE_STYLE, color: isOverridden ? "var(--accent)" : "var(--tan-3)" }}
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
