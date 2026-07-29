import { useState } from "react";
import type { ChunkNode } from "../../lib/crossview";
import { Link } from "../Link";
import { Tooltip } from "../Tooltip";
import { atlasHref } from "../../lib/routes";
import { SegmentedBar } from "./SegmentedBar";

// Recursive chunk row: plain-text title toggles expansion; a link-out icon
// (when the chunk maps to one atlas node) deep-links into the reader; the bar
// is scaled against the largest SIBLING and segmented by the chunk's children.
function ChunkRow({ node, max, atlasTotal, depth, rootDocNo }: { node: ChunkNode; max: number; atlasTotal: number; depth: number; rootDocNo?: boolean }) {
  const [open, setOpen] = useState(false);
  const kids = node.children ?? [];
  const expandable = kids.length > 0;
  const childSum = kids.reduce((s, c) => s + c.docs, 0);
  // Since the build emits EVERY child, the only unaccounted mass is the
  // section's own doc (plus hoisted wrapper docs) — a handful at most. Bar
  // segments therefore mirror the expansion exactly; no phantom tail.
  const remainder = node.docs - childSum;
  const segments = expandable
    ? [
        ...kids.map((c) => ({ id: c.id ?? c.title, doc_no: c.doc_no ?? "", title: c.title, docs: c.docs })),
        ...(remainder >= 5 ? [{ id: "__rest", doc_no: "", title: "smaller sections", docs: remainder }] : []),
      ]
    : [];
  const pct = ((node.docs / atlasTotal) * 100).toFixed(node.docs / atlasTotal >= 0.1 ? 0 : 1);
  const toggle = () => expandable && setOpen((o) => !o);
  return (
    <div>
      <div className="grid items-center gap-2 mb-1.5" style={{ gridTemplateColumns: "minmax(11rem, 18rem) 1fr 5.5rem" }}>
        <span className="flex items-center gap-1.5 min-w-0" style={{ paddingLeft: `${depth * 1.1}rem` }}>
          <button
            type="button"
            onClick={toggle}
            aria-expanded={expandable ? open : undefined}
            disabled={!expandable}
            className="flex items-center gap-1.5 min-w-0 text-left"
            style={{ color: "var(--tan-2)", cursor: expandable ? "pointer" : "default" }}
          >
            <span
              aria-hidden="true"
              className="mono text-xs shrink-0 transition-transform"
              style={{ color: "var(--tan-3)", transform: open ? "rotate(90deg)" : undefined, visibility: expandable ? "visible" : "hidden" }}
            >
              ▸
            </span>
            {/* Titles can truncate at deep indents — the tooltip always
                carries the full doc_no + title (delay=300: label hover, not
                the instant chart-segment case). */}
            <Tooltip delay={300} content={`${node.doc_no ? `${node.doc_no} ` : ""}${node.title} — ${node.docs.toLocaleString()} docs`}>
              <span className={`${depth === 0 ? "text-sm" : "text-xs"} truncate`}>
                {node.doc_no && (depth > 0 || rootDocNo) ? `${node.doc_no} ` : ""}
                {node.title}
              </span>
            </Tooltip>
          </button>
          {node.id && (
            <Link
              to={atlasHref(node.id)}
              className="link-accent inline-flex shrink-0"
              aria-label={`Open ${node.title} in the reader`}
              onClick={(e) => e.stopPropagation()}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true">
                <path d="M5 2.5H2.5v7h7V7" />
                <path d="M7 1.5h3.5V5M10.2 1.8 5.5 6.5" />
              </svg>
            </Link>
          )}
        </span>
        <button type="button" onClick={toggle} aria-hidden="true" tabIndex={-1} className="block w-full" style={{ cursor: expandable ? "pointer" : "default" }}>
          <SegmentedBar value={node.docs} max={max} segments={segments} />
        </button>
        <span className="mono text-xs text-right text-tan-3">
          {node.docs.toLocaleString()} <span style={{ opacity: 0.6 }}>·{pct}%</span>
        </span>
      </div>
      {open && (
        <div>
          {kids.map((c) => (
            <ChunkRow key={c.id ?? c.title} node={c} max={Math.max(...kids.map((k) => k.docs), 1)} atlasTotal={atlasTotal} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function CrossViewChunkTree({ tree, atlasTotal, rootDocNo }: { tree: ChunkNode[]; atlasTotal: number; rootDocNo?: boolean }) {
  const max = Math.max(...tree.map((g) => g.docs), 1);
  return (
    <div className="mt-3">
      {tree.map((g) => (
        <ChunkRow key={g.title} node={g} max={max} atlasTotal={atlasTotal} depth={0} rootDocNo={rootDocNo} />
      ))}
    </div>
  );
}
