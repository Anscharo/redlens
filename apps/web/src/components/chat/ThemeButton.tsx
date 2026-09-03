import { useEffect, useRef, useState } from "react";
import { useTheme } from "../../lib/theme";
import { ThemeGlyph } from "./glyphs";
import { ThemePicker } from "./ThemePicker";

const PANEL_ID = "nav-theme-picker";

// Nav colour-scheme control. Icon follows the active theme id (sun / crescent
// / eclipse); click opens ThemePicker. Lives in the top bar rather than the
// account menu so it is reachable without a login and in preview.
export function ThemeButton() {
  const { theme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        className="rlc-signin"
        aria-label="Colour scheme"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? PANEL_ID : undefined}
        data-state={open ? "open" : "closed"}
        title="Colour scheme"
        onClick={() => setOpen((v) => !v)}
      >
        <ThemeGlyph theme={theme} />
      </button>
      {open && (
        <div id={PANEL_ID} className="rlc-menu">
          <ThemePicker />
        </div>
      )}
    </div>
  );
}
