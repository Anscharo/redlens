import { useRef } from "react";
import { THEMES, useTheme } from "../../lib/theme";
import { ThemeGlyph } from "./glyphs";

// The theme row-group opened by ThemeButton in the nav. Renders straight
// from THEMES — a fourth theme needs no edit here. `role="radio"` per row
// (not `switch`): this is a single-select-of-N control, not an on/off toggle.
export function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    let delta = 0;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") delta = 1;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") delta = -1;
    else return;
    e.preventDefault();
    const next = (i + delta + THEMES.length) % THEMES.length;
    setTheme(THEMES[next].id);
    rowRefs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label="Theme">
      {THEMES.map((t, i) => {
        const selected = t.id === theme;
        return (
          <button
            key={t.id}
            ref={(el) => {
              rowRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            data-state={selected ? "checked" : "unchecked"}
            tabIndex={selected ? 0 : -1}
            className="rlc-menu-item"
            onClick={() => setTheme(t.id)}
            onKeyDown={(e) => handleKeyDown(e, i)}
          >
            <span className="min-w-0">
              <span className="text-[12.5px] block">{t.label}</span>
              <span className="mono text-[9.5px] text-gray block">{t.hint}</span>
            </span>
            <span aria-hidden="true" className="rlc-theme-mark text-accent shrink-0">
              {selected ? "✓" : <ThemeGlyph theme={t.id} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
