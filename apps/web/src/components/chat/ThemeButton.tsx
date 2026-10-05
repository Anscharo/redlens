import { useRef } from "react";
import { useDismissiblePopover } from "./useLightDismiss";
import { useTheme } from "../../lib/theme";
import { ThemeGlyph } from "./ThemeGlyph";
import { ThemePicker } from "./ThemePicker";

const PANEL_ID = "nav-theme-picker";

// Nav colour-scheme control. Icon follows the active theme id (sun / crescent
// / eclipse); click opens ThemePicker. Lives in the top bar rather than the
// account menu so it is reachable without a login and in preview.
export function ThemeButton() {
  const { theme } = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useDismissiblePopover(ref, { escapeTarget: window, claimEscape: true });

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
