import { useMemo, useState } from "react";
import type { ChunkNode } from "../../lib/crossview";
import { buildTreemap, flattenTreemap, type TreemapRect } from "../../lib/treemap";
import { Link } from "../Link";
import { atlasHref } from "@/lib/routes";

// Nested squarified treemap of the chunk tree: every rect's area is its doc
// share; the largest chunk sits in its parent's top-left, recursively. Single
// sequential hue (--chunk-fill) deepening with nesting depth — identity comes
// from geometry + labels, not a categorical palette. NOT --red: the ramp is
// mixed into --surface and then has a --tan-2 label painted on it, so its
// source has to be chosen against that LABEL. --red is the brand's decorative
// slot and carries no such guarantee — in giedi it is a near-white, which ran
// the ramp backwards and left the deepest labels at 1.6:1. 2px surface gaps
// separate sibling fills; a click outlines the deepest rect and fills the
// info panel. Click (not hover) so the panel stays put long enough to use
// the reader link — hovering the map to reveal it, then leaving to click
// it, used to clear the selection first. Rects are sibling <button>s (coords
// are already root-space) so nested <button>s stay illegal, keyboard and
// screen readers still reach every chunk, and z-index=depth lets the
// deepest square claim the click.
const FILL_BY_DEPTH = [0.22, 0.34, 0.48, 0.62];
/** Square cap. Details sit to the right from 650px of available width; stacked below. */
const MAP_MAX_PX = 580;
/** Nested chunks below this share of the Atlas are omitted. Top-level always stays. */
const MIN_SHARE = 0.02;
/** Six levels: depth 0 (top-level groups) through depth 5. */
const MAX_DEPTH = 6;

function Rect({
  r,
  selected,
  onSelect,
}: {
  r: TreemapRect;
  selected: TreemapRect | null;
  onSelect: (r: TreemapRect) => void;
}) {
  const isSelected = selected === r;
  const showLabel = r.w > 9 && r.h > 4.5;
  const name =
    r.path.length > 0 ? `${r.path.map((p) => p.title).join(" › ")} › ${r.node.title}` : r.node.title;
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      aria-label={name}
      data-state={isSelected ? "active" : "inactive"}
      className="absolute overflow-hidden p-0 text-left focus-visible:outline-offset-[-2px]"
      style={{
        left: `${r.x}%`,
        top: `${r.y}%`,
        width: `${r.w}%`,
        height: `${r.h}%`,
        zIndex: r.depth,
        background: `color-mix(in srgb, var(--chunk-fill) ${Math.round((FILL_BY_DEPTH[r.depth] ?? 0.7) * 100)}%, var(--surface))`,
        border: isSelected ? "2px solid var(--accent)" : "1px solid var(--bg)",
        borderRadius: 3,
        cursor: "pointer",
      }}
      onClick={() => onSelect(r)}
    >
      {showLabel && (
        <span
          aria-hidden="true"
          className="mono absolute top-1.5 left-1.5 right-1.5 line-clamp-2 pointer-events-none"
          style={{ fontSize: r.depth === 0 ? 12 : 10, lineHeight: 1.2, color: "var(--tan-2)" }}
        >
          {r.node.title}
        </span>
      )}
    </button>
  );
}

function InfoPanel({ rect, atlasTotal }: { rect: TreemapRect | null; atlasTotal: number }) {
  if (!rect) {
    return (
      <p className="text-xs" style={{ color: "var(--tan-3)" }}>
        Click a square for details. Area is proportional to doc count; each chunk&apos;s largest
        sub-chunk sits in its top-left corner.
      </p>
    );
  }
  const n = rect.node;
  const pct = ((n.docs / atlasTotal) * 100).toFixed(n.docs / atlasTotal >= 0.1 ? 0 : 1);
  return (
    <div className="min-w-0">
      <p className="mono text-xs text-tan-3 truncate">{rect.path.map((p) => p.title).join(" › ") || "Atlas"}</p>
      <p className="text-sm font-semibold mt-1" style={{ color: "var(--tan)" }}>
        {n.doc_no ? `${n.doc_no} ` : ""}
        {n.title}
      </p>
      <p className="mono text-xs mt-2" style={{ color: "var(--tan-2)" }}>
        {n.docs.toLocaleString()} docs · {pct}% of the Atlas · level {rect.depth + 1}
        {n.children?.length ? ` · ${n.children.length} sub-chunks` : ""}
      </p>
      {n.id && (
        <Link to={atlasHref(n.id)} className="mono text-xs link-accent mt-2 inline-block">
          open in reader →
        </Link>
      )}
    </div>
  );
}

export function CrossViewTreemap({ tree, atlasTotal }: { tree: ChunkNode[]; atlasTotal: number }) {
  const [selected, setSelected] = useState<TreemapRect | null>(null);
  const rects = useMemo(
    () =>
      flattenTreemap(
        buildTreemap(tree, {
          minArea: 14,
          maxDepth: MAX_DEPTH,
          pad: 0.6,
          padTop: 5,
          minShare: MIN_SHARE,
          atlasTotal,
        }),
      ),
    [tree, atlasTotal],
  );
  return (
    <div className="@container">
      <div className="flex flex-col gap-4 @min-[650px]:flex-row @min-[650px]:items-start">
        <div
          className="relative aspect-square w-full shrink-0"
          style={{ maxWidth: MAP_MAX_PX, background: "var(--surface)", borderRadius: 4 }}
          role="group"
          aria-label="Treemap of Atlas chunks sized by document count"
        >
          {rects.map((r) => (
            <Rect
              key={r.node.id ?? `${r.path.map((p) => p.title).join("/")}/${r.node.title}`}
              r={r}
              selected={selected}
              onSelect={(next) => setSelected((cur) => (cur === next ? null : next))}
            />
          ))}
        </div>
        <aside className="min-h-[5.5rem] min-w-0 flex-1 sticky top-16 pt-1" aria-live="polite">
          <InfoPanel rect={selected} atlasTotal={atlasTotal} />
        </aside>
      </div>
    </div>
  );
}
