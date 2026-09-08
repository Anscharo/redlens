import type { CrossViewSegment } from "../../lib/crossview";
import { Tooltip } from "../Tooltip";

// Approximate rendered bar-track width; only used to decide which tail
// segments are too thin to see and should merge into one "+N smaller" block.
const TRACK_PX = 440;
const MIN_SEG_PX = 4;

// Stacked weight bar: sub-element segments largest→smallest, left→right, in a
// descending shade of --red so the internal composition is visible. Bar length
// is the row's share of `max`; segments fill it proportionally (normalized to
// the segment sum — the parent's own doc is a rounding sliver).
export function SegmentedBar({ value, max, segments }: { value: number; max: number; segments: CrossViewSegment[] }) {
  const all = segments.filter((s) => s.docs > 0);
  const segSum = all.reduce((s, x) => s + x.docs, 0) || 1;
  const barPct = Math.max(1, (value / max) * 100);
  // Segments that would render thinner than MIN_SEG_PX collapse into one
  // tail block (they're sorted largest-first, so it's always a suffix).
  const pxOf = (docs: number) => (docs / segSum) * (barPct / 100) * TRACK_PX;
  const visible = all.filter((s) => pxOf(s.docs) >= MIN_SEG_PX);
  const tail = all.slice(visible.length);
  const tailDocs = tail.reduce((s, x) => s + x.docs, 0);
  const segs: (CrossViewSegment & { isTail?: boolean })[] =
    tail.length > 1
      ? [...visible, { id: "__tail", doc_no: "", title: `${tail.length} smaller sections`, docs: tailDocs, isTail: true }]
      : all;
  return (
    <div className="h-3 rounded-sm" style={{ background: "var(--surface)" }}>
      <div className="h-full flex rounded-sm overflow-hidden" style={{ width: `${barPct}%`, gap: "1px" }}>
        {segs.length === 0 ? (
          <div className="h-full w-full" style={{ background: "var(--red)" }} />
        ) : (
          segs.map((s, i) => (
            // delay={0}: segments are the whole point of this chart — the name
            // should appear the instant the pointer lands, not after the 200ms
            // app default used elsewhere.
            <Tooltip key={s.id} delay={0} content={`${s.doc_no ? `${s.doc_no} ` : ""}${s.title} — ${s.docs.toLocaleString()} docs`}>
              <div
                className="h-full"
                style={{
                  width: `${(s.docs / segSum) * 100}%`,
                  background: "var(--red)",
                  // Largest segment full strength, fading toward the small tail.
                  opacity: s.isTail ? 0.3 : 1 - (segs.length > 1 ? (i / (segs.length - 1)) * 0.65 : 0),
                }}
              />
            </Tooltip>
          ))
        )}
      </div>
    </div>
  );
}
