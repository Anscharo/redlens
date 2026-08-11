import { useHint } from "../lib/hintStore";
import { useOnlineStatus } from "../hooks/useOnlineStatus";

/**
 * The footer's contextual hint: what the keys under your fingers, or the thing
 * under your cursor, will do right now. It takes the corner the status pills
 * use — a hint outranks "update available" and "atlas updated" (both stay
 * clickable underneath, and both survive a reload), but never "offline", which
 * is a live fault the user cannot dismiss and tree focus is sticky enough to
 * bury it for a whole session.
 *
 * Absolutely positioned rather than a flow child. FooterInfo centers itself
 * with mx-auto whenever no status pill leads it, so a hint in the flow would
 * flip that centering on and off with every hover and jitter the whole
 * build-info row. Overlaying instead leaves Footer's own layout untouched:
 * `background: var(--bg)` occludes the pills cleanly and `pointer-events: none`
 * (in index.css) keeps whatever is beneath it clickable.
 *
 * aria-hidden because every gesture it describes is already reachable another
 * way — the row titles, aria-labels, and the tree's own arrow keys — and a live
 * region here would announce on every pointer move.
 */
export function FooterHint() {
  const hint = useHint();
  const online = useOnlineStatus();
  if (!hint || !online) return null;
  return (
    <div className="footer-hint mono" aria-hidden="true">
      {hint}
    </div>
  );
}
