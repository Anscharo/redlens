import { useEffect } from "react";

/** How long `data-alt-turn` stays up after Alt goes down or up — just longer
 *  than the fast transition it switches on (see index.css). Lifting it early
 *  would drop the chevron back onto the slow drift curve mid-swing; lifting it
 *  late is harmless, since changing a transition-duration doesn't itself start
 *  a transition. */
export const ALT_TURN_MS = 260;

/**
 * Mirrors the Alt/Option and Shift keys onto `<html data-alt>` / `<html
 * data-shift>` so stylesheets can react to them. CSS cannot observe modifier
 * keys, so the key state has to come from JS — but only the state does: the
 * rules themselves stay in CSS.
 *
 *   data-alt   — the reader chevron previews a different target while Alt is
 *                held, because alt-click reverses the pendulum swing.
 *   data-alt-turn — set for ALT_TURN_MS whenever data-alt flips, in either
 *                direction, so the chevron snaps between the two previews
 *                instead of creeping there on the slow hover-drift curve.
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
    let turnTimer: ReturnType<typeof setTimeout> | undefined;
    /** Returns whether the attribute actually changed — pressing Alt fires a
     *  keydown per repeat, and only a real flip should restart the snap. */
    const set = (attr: string, on: boolean) => {
      if (root.hasAttribute(attr) === on) return false;
      if (on) root.setAttribute(attr, "");
      else root.removeAttribute(attr);
      return true;
    };
    // Stamped in the SAME tick as the data-alt flip, so the style recalc that
    // moves the chevron already sees the fast duration. Both directions: a
    // snap out to the reverse preview and a slow crawl back on release is the
    // same lie in mirror image.
    const markAltTurn = () => {
      root.setAttribute("data-alt-turn", "");
      clearTimeout(turnTimer);
      turnTimer = setTimeout(() => root.removeAttribute("data-alt-turn"), ALT_TURN_MS);
    };
    const apply = (alt: boolean, shift: boolean) => {
      if (set("data-alt", alt)) markAltTurn();
      set("data-shift", shift);
    };
    // Read the modifier flags off the event rather than tracking key names:
    // that handles either Alt/Shift, and stays right if the key repeats.
    // The one exception is a keyup of the modifier ITSELF. The flag is supposed
    // to already read false there, but it can't be relied on — a keyup that
    // still reports its own modifier as held would leave the attribute stuck
    // on, and then every chevron previews the alt target with Alt long
    // released. Releasing the key means the key is not held, full stop, so the
    // code of the released key overrides the flag. (`blur` is the only other
    // recovery, and it needs the window to lose focus first.)
    const onKey = (e: KeyboardEvent) => {
      const up = e.type === "keyup";
      apply(
        e.altKey && !(up && e.code.startsWith("Alt")),
        e.shiftKey && !(up && e.code.startsWith("Shift")),
      );
    };
    // A modifier held while focus leaves the window never delivers its keyup,
    // so the attribute would stick on — the chevrons would preview the wrong
    // target and the split-pane hints would sit there with Shift long released.
    const clear = () => apply(false, false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", clear);
      clear();
      clearTimeout(turnTimer);
      root.removeAttribute("data-alt-turn");
    };
  }, []);
}
