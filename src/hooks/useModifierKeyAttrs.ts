import { useEffect } from "react";

/**
 * Mirrors the Alt/Option and Shift keys onto `<html data-alt>` / `<html
 * data-shift>` so stylesheets can react to them. CSS cannot observe modifier
 * keys, so the key state has to come from JS — but only the state does: the
 * rules themselves stay in CSS.
 *
 *   data-alt   — the reader chevron previews a different target while Alt is
 *                held, because alt-click reverses the pendulum swing.
 *   data-shift — rows whose shift-click opens the comparison pane surface a
 *                hint while Shift is held (see .atlas-node / .tree-row).
 *
 * Plain attribute writes, never React state: these keys are pressed and
 * released constantly, and routing that through a render would re-render every
 * row in the reader for a purely visual hint.
 *
 * Mounted once at the App shell — the reader and the tree sidebar can mount
 * independently of each other, so neither is a safe home for it.
 */
export function useModifierKeyAttrs() {
  useEffect(() => {
    const root = document.documentElement;
    const set = (attr: string, on: boolean) => {
      if (on) root.setAttribute(attr, "");
      else root.removeAttribute(attr);
    };
    // Read the modifier flags off the event rather than tracking key names:
    // that handles either Alt/Shift, and stays right if the key repeats.
    const onKey = (e: KeyboardEvent) => {
      set("data-alt", e.altKey);
      set("data-shift", e.shiftKey);
    };
    // A modifier held while focus leaves the window never delivers its keyup,
    // so the attribute would stick on — the chevrons would preview the wrong
    // target and the split-pane hints would sit there with Shift long released.
    const clear = () => {
      set("data-alt", false);
      set("data-shift", false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", clear);
      clear();
    };
  }, []);
}
