import { contrastRatio, rateContrast, SWATCH_WORST_BG } from "./contrast";
import { Swatch } from "./Swatch";
import type { PaletteToken } from "./palette-tokens";

interface SwatchGridProps {
  tokens: readonly PaletteToken[];
  effectiveValue: (name: string) => string;
  draft: Record<string, string>;
  onSwatchClick: (name: string) => void;
}

export function SwatchGrid({ tokens, effectiveValue, draft, onSwatchClick }: SwatchGridProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
        gap: 10,
      }}
    >
      {tokens.map((token) => {
        const value = effectiveValue(token.name);
        const bgName = SWATCH_WORST_BG[token.name];
        const bgValue = bgName ? effectiveValue(bgName) : null;
        const ratio = bgValue ? contrastRatio(value, bgValue) : null;
        const contrastBadge = ratio != null ? { ratio, level: rateContrast(ratio) } : undefined;
        return (
          <Swatch
            key={token.name}
            token={token}
            value={value}
            isOverridden={token.name in draft}
            onClick={() => onSwatchClick(token.name)}
            contrastBadge={contrastBadge}
          />
        );
      })}
    </div>
  );
}
