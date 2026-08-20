import { useMemo, useState } from "react";
import type { ChunkNode } from "../../lib/crossview";
import { buildTreemap, type TreemapRect } from "../../lib/treemap";
import { Link } from "../Link";
import { atlasHref } from "@/lib/routes";

// Nested squarified treemap of the chunk tree: every rect's area is its doc
// share; the largest chunk sits in its parent's top-left, recursively. Single
// sequential hue (--red) deepening with nesting depth — identity comes from
// geometry + labels, not a categorical palette. 2px surface gaps separate
// sibling fills; hover outlines the deepest rect under the pointer and fills
// the info panel on the right.
const FILL_BY_DEPTH = [0.22, 0.34, 0.48, 0.62];

interface UnitBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function Rect({
  r,
  parent,
  hovered,
  onHover,
}: {
  r: TreemapRect;
  /** The parent's box in ROOT unit space — rects stay root-space throughout;
      only the CSS placement converts to the parent's local percentage frame. */
  parent: UnitBox;
  hovered: TreemapRect | null;
  onHover: (r: TreemapRect | null) => void;
}) {
  const isHovered = hovered === r;
  const showLabel = r.w > 9 && r.h > 4.5;
  return (
    <div
      // mouseover (not mouseenter): it bubbles, so the DEEPEST rect under the
      // pointer claims the hover and stopPropagation shields its ancestors —
      // and moving from a child back onto the parent re-fires on the parent.
      onMouseOver={(e) => {
        e.stopPropagation();
        onHover(r);
      }}
      className="absolute overflow-hidden"
      style={{
        left: `${((r.x - parent.x) / parent.w) * 100}%`,
        top: `${((r.y - parent.y) / parent.h) * 100}%`,
        width: `${(r.w / parent.w) * 100}%`,
        height: `${(r.h / parent.h) * 100}%`,
        background: `color-mix(in srgb, var(--red) ${Math.round((FILL_BY_DEPTH[r.depth] ?? 0.7) * 100)}%, var(--surface))`,
        border: isHovered ? "2px solid var(--accent)" : "1px solid var(--bg)",
        borderRadius: 3,
      }}
    >
      {showLabel && (
        <span
          className="mono absolute top-0.5 left-1 right-1 truncate pointer-events-none"
          style={{ fontSize: 10, color: "var(--tan-2)" }}
        >
          {r.node.title}
        </span>
      )}
      {r.children.map((c) => (
        <Rect key={c.node.id ?? c.node.title} r={c} parent={r} hovered={hovered} onHover={onHover} />
      ))}
    </div>
  );
}

function InfoPanel({ rect, atlasTotal }: { rect: TreemapRect | null; atlasTotal: number }) {
  if (!rect) {
    return (
      <p className="text-xs" style={{ color: "var(--tan-3)" }}>
        Hover a square for details. Area is proportional to doc count; each chunk&apos;s largest
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
        {n.docs.toLocaleString()} docs · {pct}% of the Atlas
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
  const [hovered, setHovered] = useState<TreemapRect | null>(null);
  const rects = useMemo(
    () => buildTreemap(tree, { minArea: 14, maxDepth: 4, pad: 0.5, padTop: 2.6 }),
    [tree],
  );
  return (
    <div className="flex gap-4 items-start flex-wrap">
      <div
        className="relative aspect-square w-full"
        style={{ maxWidth: 480, background: "var(--surface)", borderRadius: 4 }}
        onMouseLeave={() => setHovered(null)}
        role="img"
        aria-label="Treemap of Atlas chunks sized by document count"
      >
        {rects.map((r) => (
          <Rect
            key={r.node.id ?? r.node.title}
            r={r}
            parent={{ x: 0, y: 0, w: 100, h: 100 }}
            hovered={hovered}
            onHover={setHovered}
          />
        ))}
      </div>
      <aside className="flex-1 min-w-[12rem] sticky top-16 pt-1">
        <InfoPanel rect={hovered} atlasTotal={atlasTotal} />
      </aside>
    </div>
  );
}
