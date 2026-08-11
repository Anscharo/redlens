import { useHint } from "../lib/hintStore";

// Two or more arrow glyphs in a row name keys you press, and get drawn as
// keycaps — at the footer's 10px a bare glyph is too fine to read as a key, and
// a box says "press this" in a way an inline character cannot. A LONE arrow is
// the "leads to" separator in "Shift-click → open in Splitview" and stays plain
// text, so the run length is what tells the two apart. Split keeps the captured
// runs in the output at every odd index.
const ARROW_KEYS = /([↑↓←→]{2,})/;

/**
 * The footer's contextual hint: what the keys under your fingers, or the thing
 * under your cursor, will do right now. It takes the corner the status pills
 * use and outranks all of them — including "offline", which stays one reload
 * away from being seen again.
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
  if (!hint) return null;
  return (
    <div className="footer-hint mono" aria-hidden="true">
      {hint.split(ARROW_KEYS).map((part, i) =>
        i % 2 ? (
          <span key={i} className="footer-hint-keys">
            {[...part].map((k, j) => (
              <kbd key={j}>{k}</kbd>
            ))}
          </span>
        ) : (
          part
        ),
      )}
    </div>
  );
}
