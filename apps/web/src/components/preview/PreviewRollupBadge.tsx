import { useLayoutEffect, useRef, useState } from "react";
import { chicletColor } from "@/lib/depth";

const FADE_MS = 180;

// Preview rollup badge: a small count shown on a COLLAPSED ancestor whose
// subtree hides N added/changed docs. White fill with a pale ring tinted by the
// deepest change's depth colour (same scale as the doc-no chiclets); the number
// is dark so it reads on the white fill. Subordinate to PreviewMark (the +/Δ on a doc that
// itself changed). Renders nothing when there's nothing below. Clicking it
// expands just the paths down to the changes (onReveal), so they become visible.
//
// When its node goes collapsed→expanded the badge fades AND collapses its width
// to 0 over FADE_MS, so the title to its right slides in smoothly instead of
// jumping when the badge unmounts. The negative left margin in the leaving state
// cancels the row's flex gap, so the end position exactly matches the unmounted
// layout (no residual jump). Keyed by node id upstream so virtualized row
// recycling can't carry a stale fade phase to another node.
export function PreviewRollupBadge({
  entry,
  expanded,
  onReveal,
  className,
}: {
  entry?: { count: number; depth: number };
  expanded: boolean;
  onReveal?: () => void;
  className?: string;
}) {
  const [phase, setPhase] = useState<"shown" | "leaving" | "gone">(expanded ? "gone" : "shown");
  const wasExpanded = useRef(expanded);
  const ref = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const was = wasExpanded.current;
    wasExpanded.current = expanded;
    if (expanded && !was) {
      const el = ref.current;
      if (!el) {
        setPhase("gone");
        return;
      }
      // Pin the current auto width to a concrete px value so the transition to 0
      // has something to animate from, then flip to the collapsed state.
      el.style.width = `${el.offsetWidth}px`;
      void el.offsetWidth; // force reflow so the pin takes before we collapse
      setPhase("leaving");
      const t = setTimeout(() => setPhase("gone"), FADE_MS);
      return () => clearTimeout(t);
    }
    if (!expanded && was) setPhase("shown");
  }, [expanded]);

  if (!entry || entry.count <= 0 || phase === "gone") return null;
  const { count, depth } = entry;
  const leaving = phase === "leaving";
  const label = `Expand to ${count} changed doc${count === 1 ? "" : "s"} below`;
  return (
    <button
      ref={ref}
      type="button"
      className={className}
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onReveal?.();
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        overflow: "hidden",
        height: 14,
        minWidth: leaving ? 0 : 14,
        width: leaving ? 0 : undefined,
        padding: leaving ? 0 : "0 3px",
        marginLeft: leaving ? -2 : 0, // cancel the row's 2px flex gap as it closes
        borderWidth: leaving ? 0 : 1,
        borderStyle: "solid",
        // Inverted chiclet, deliberately: --tan/--bg is a self-inverting pair —
        // --tan is the brightest thing on dark and the darkest on light, --bg
        // its inverse — so this reproduces "pale fill, dark text" in dark mode
        // and flips correctly to "dark fill, pale text" in light mode.
        borderColor: `color-mix(in srgb, ${chicletColor(depth)} 75%, var(--tan))`,
        borderRadius: 6,
        backgroundColor: "var(--tan)",
        color: "var(--bg)",
        fontWeight: 600,
        flexShrink: 0,
        lineHeight: 1,
        cursor: "pointer",
        opacity: leaving ? 0 : 1,
        // Only the props that actually move on collapse — not `all` (which would
        // also watch colour/cursor/border-style and animate any future addition).
        transition: ["width", "min-width", "padding", "margin-left", "border-width", "opacity"]
          .map((p) => `${p} ${FADE_MS}ms ease`)
          .join(", "),
      }}
    >
      {count}
    </button>
  );
}
