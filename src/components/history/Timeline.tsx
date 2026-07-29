import type { CSSProperties, ReactNode } from "react";

// The history list is one continuous timeline: every block in it — entries and
// the interleaved disclaimers/toggles alike — renders as a TimelineRow, so the
// rail in the left gutter runs unbroken from the top of the list to the bottom,
// with a node dot on the rows that are actual changes.
const RAIL_W = 18; // px — gutter width
const GAP = 12; // px — gutter → content gap
const PAD_Y = 10; // px — vertical padding of a dotted row's content (Tailwind py-2.5)
/** Line-height of an entry's first line. The node dot centers on it, so EntryRow
 *  must set this as the line-1 line-height for the dot to line up with the date. */
export const LINE1_H = 18;
const NODE_TOP = PAD_Y + LINE1_H / 2; // px — vertical center of the node dot
const NODE_D = 9; // px — node diameter
// Bleed 1px past the row so the rail crosses the entry separator border below it
// and the whole list reads as one line rather than per-row stubs.
const BLEED = -1;

/** Left edge of a row's content column. Headings and status lines that stand
 *  outside the timeline (no rail of their own) indent to this so they line up
 *  with the entry text instead of with the rail. */
export const CONTENT_INDENT = RAIL_W + GAP;

const CENTER: CSSProperties = { left: RAIL_W / 2, transform: "translateX(-50%)" };
const LINE: CSSProperties = { ...CENTER, width: 1, background: "var(--border)" };
// Preview (not-yet-cemented) entries dissolve the downward line into a fuzzy,
// dashed break so it reads as "not committed into the timeline yet."
const FUZZ_LINE: CSSProperties = {
  ...CENTER,
  width: 2,
  backgroundImage: "repeating-linear-gradient(var(--preview-add) 0 3px, transparent 3px 7px)",
  WebkitMaskImage: "linear-gradient(to bottom, black, transparent 90%)",
  maskImage: "linear-gradient(to bottom, black, transparent 90%)",
};

interface RowProps {
  /** Node dot color for a change entry; omit for the connective blocks
   *  (disclaimers, footers, the reconstructed-history toggle) that sit inside
   *  the timeline but aren't themselves changes. */
  dot?: string;
  fuzz?: boolean;
  /** Trim the rail above this row — only the topmost block of the list. */
  hideTop?: boolean;
}

function Rail({ dot, fuzz, hideTop }: RowProps) {
  return (
    <div className="relative shrink-0 self-stretch" style={{ width: RAIL_W }} aria-hidden="true">
      {!dot ? (
        !hideTop && <span className="absolute" style={{ ...LINE, top: 0, bottom: BLEED }} />
      ) : (
        <>
          {!hideTop && <span className="absolute" style={{ ...LINE, top: 0, height: NODE_TOP }} />}
          <span
            className="absolute"
            style={{ ...(fuzz ? FUZZ_LINE : LINE), top: NODE_TOP, bottom: BLEED }}
          />
          {/* Tick from the dot across the gutter gap to where the date starts, so
              the node reads as attached to its entry rather than floating beside it. */}
          <span
            className="absolute"
            style={{
              left: RAIL_W / 2,
              top: NODE_TOP,
              width: RAIL_W / 2 + GAP,
              height: 1,
              background: "var(--border)",
            }}
          />
          <span
            className="absolute rounded-full"
            style={{
              ...CENTER,
              top: NODE_TOP,
              marginTop: -(NODE_D / 2),
              width: NODE_D,
              height: NODE_D,
              background: fuzz ? "var(--bg)" : dot,
              // The ring in the panel bg punches the dot out of the line behind it.
              border: fuzz ? "1.5px dashed var(--preview-add)" : "2px solid var(--bg)",
            }}
          />
        </>
      )}
    </div>
  );
}

export function TimelineRow({ children, ...rail }: RowProps & { children: ReactNode }) {
  return (
    <div className="flex" style={{ gap: GAP }}>
      <Rail {...rail} />
      {/* Dotted rows own the vertical rhythm (the dot centers on line 1 through
          PAD_Y); connective blocks bring their own margins. */}
      <div className={rail.dot ? "min-w-0 flex-1 py-2.5" : "min-w-0 flex-1"}>{children}</div>
    </div>
  );
}
