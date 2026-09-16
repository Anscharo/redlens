// Phone layout for Potential Mistakes: one finding at a time, stacked
// vertically. Swipe left for the next row, right for the previous; the
// previous/next buttons and arrow keys do the same for anyone who isn't swiping.
import { useCallback, useRef, useState, type PointerEvent } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import type { MistakeRow } from "@/lib/potentialMistakesIndex";
import type { ReportQuery } from "@/lib/reportFilter";
import { MistakeCard } from "./MistakeCard";

const SWIPE_PX = 48;

export type PotentialMistakesPagerProps = {
  rows: readonly MistakeRow[];
  rq: ReportQuery;
};

export function PotentialMistakesPager({ rows, rq }: PotentialMistakesPagerProps) {
  const [id, setId] = useState(rows[0]?.id);
  const reduce = useMediaQuery("(prefers-reduced-motion: reduce)");
  const start = useRef<{ x: number; y: number; pointer: number } | null>(null);
  const [dx, setDx] = useState(0);

  const index = Math.max(0, rows.findIndex((r) => r.id === id));
  const row = rows[index] ?? rows[0];
  const at = index === 0 ? "first" : index === rows.length - 1 ? "last" : "middle";

  const go = useCallback(
    (i: number) => {
      const next = rows[Math.min(rows.length - 1, Math.max(0, i))];
      if (next) setId(next.id);
    },
    [rows],
  );

  if (!row) return null;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, pointer: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s || e.pointerId !== s.pointer) return;
    const x = e.clientX - s.x;
    const y = e.clientY - s.y;
    if (Math.abs(x) < 8 || Math.abs(x) < Math.abs(y)) return;
    setDx(x);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    start.current = null;
    setDx(0);
    if (!s || e.pointerId !== s.pointer) return;
    const x = e.clientX - s.x;
    const y = e.clientY - s.y;
    if (Math.abs(x) < SWIPE_PX || Math.abs(x) < Math.abs(y)) return;
    go(index + (x < 0 ? 1 : -1));
  };

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Potential mistakes"
      data-focus-hint="mistakes-pager"
      data-state={at}
      tabIndex={0}
      className="outline-none"
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(index - 1);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          go(index + 1);
        }
      }}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <button
          type="button"
          aria-label="Previous finding"
          disabled={index === 0}
          className="min-h-11 min-w-11 text-tan-2 disabled:text-tan-3"
          onClick={() => go(index - 1)}
        >
          ←
        </button>
        <p className="mono text-xs text-tan-3 m-0" aria-live="polite">
          {index + 1} of {rows.length}
        </p>
        <button
          type="button"
          aria-label="Next finding"
          disabled={index === rows.length - 1}
          className="min-h-11 min-w-11 text-tan-2 disabled:text-tan-3"
          onClick={() => go(index + 1)}
        >
          →
        </button>
      </div>
      <div
        className="touch-pan-y"
        style={reduce || !dx ? undefined : { transform: `translateX(${dx}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          start.current = null;
          setDx(0);
        }}
      >
        <MistakeCard r={row} rq={rq} />
      </div>
    </section>
  );
}
