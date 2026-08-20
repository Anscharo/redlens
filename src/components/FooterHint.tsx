import { useHint } from "@/lib/hintStore";

// [Square brackets] in the copy mark a key you press (see hintText). Splitting
// on a capturing group leaves the key names at every odd index.
const KEY = /\[([^\]]+)\]/;

/**
 * The footer's contextual hint: what the keys under your fingers, or the thing
 * under your cursor, will do right now. It takes the corner the status pills
 * use and outranks all of them — including "offline", which stays one reload
 * away from being seen again.
 *
 * Absolutely positioned rather than a flow child, same as the status pills:
 * FooterInfo centers itself with mx-auto, so a hint in the flow would shove
 * the whole build-info row off-center with every hover and jitter it.
 * Overlaying instead leaves Footer's own layout untouched:
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
      {/* One wrapper, so the flex centering in index.css has a single item to
          centre. Letting the parts be flex items directly would split the
          sentence into one item per text run and eat the spaces between them. */}
      <span className="footer-hint-line">
        {hint.split(KEY).map((part, i) => (i % 2 ? <kbd key={i}>{part}</kbd> : part))}
      </span>
    </div>
  );
}
