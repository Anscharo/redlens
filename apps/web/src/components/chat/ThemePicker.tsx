import { useRef, type ComponentProps, type KeyboardEvent } from "react";
import { THEMES, useTheme } from "../../lib/theme";
import { ThemeGlyph } from "./ThemeGlyph";

// Arrow keys move the selection through the rows, wrapping at both ends;
// null for any other key.
function nextRow(key: string, i: number): number | null {
  if (key === "ArrowDown" || key === "ArrowRight") return (i + 1) % THEMES.length;
  if (key === "ArrowUp" || key === "ArrowLeft") return (i - 1 + THEMES.length) % THEMES.length;
  return null;
}

interface ThemeRowProps extends ComponentProps<"button"> {
  /** The theme this row selects. */
  theme: (typeof THEMES)[number];
  /** Whether it is the active theme. */
  selected: boolean;
}

function ThemeRow({ theme, selected, ...props }: ThemeRowProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      data-state={selected ? "checked" : "unchecked"}
      tabIndex={selected ? 0 : -1}
      className="rlc-menu-item"
      {...props}
    >
      <span className="min-w-0">
        <span className="text-[12.5px] block">{theme.label}</span>
        <span className="mono text-[9.5px] text-gray block">{theme.hint}</span>
      </span>
      <span aria-hidden="true" className="rlc-theme-mark text-accent shrink-0">
        {selected ? "✓" : <ThemeGlyph theme={theme.id} />}
      </span>
    </button>
  );
}

// The theme row-group opened by ThemeButton in the nav. Renders straight
// from THEMES — a fourth theme needs no edit here. `role="radio"` per row
// (not `switch`): this is a single-select-of-N control, not an on/off toggle.
export function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = nextRow(e.key, i);
    if (next === null) return;
    e.preventDefault();
    setTheme(THEMES[next].id);
    rowRefs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Theme">
      {THEMES.map((t, i) => (
        <ThemeRow
          key={t.id}
          theme={t}
          selected={t.id === theme}
          ref={(el) => {
            rowRefs.current[i] = el;
          }}
          onClick={() => setTheme(t.id)}
          onKeyDown={(e) => onKeyDown(e, i)}
        />
      ))}
    </div>
  );
}
