import type { CSSProperties } from "react";

// A vertical timeline rail: a thin line with a node dot per history entry. The
// left gutter of every EntryRow (and the preview pseudo-entry) renders one, so a
// contiguous run of entries reads as a single connected timeline.
const RAIL_W = 18; // px — gutter width
const NODE_TOP = 18; // px — vertical center of the node dot (aligns with line 1)
const NODE_D = 9; // px — node diameter

const CENTER: CSSProperties = { left: RAIL_W / 2, transform: "translateX(-50%)" };

export function TimelineRail({
  color,
  fuzz = false,
  hideTop = false,
  hideBottom = false,
}: {
  /** Node dot color — usually the change-type color for this entry. */
  color: string;
  /** Preview (not-yet-cemented) entries dissolve the downward line into a fuzzy,
   *  dashed break so it reads as "not committed into the timeline yet." */
  fuzz?: boolean;
  /** Trim the segment above the node — the newest (topmost) entry has nothing above it. */
  hideTop?: boolean;
  /** Trim the segment below the node. */
  hideBottom?: boolean;
}) {
  return (
    <div className="relative shrink-0 self-stretch" style={{ width: RAIL_W }} aria-hidden="true">
      {!hideTop && (
        <span
          className="absolute"
          style={{ ...CENTER, top: 0, height: NODE_TOP, width: 1, background: "var(--border)" }}
        />
      )}
      {!hideBottom && (
        <span
          className="absolute"
          style={{
            ...CENTER,
            top: NODE_TOP,
            bottom: 0,
            width: fuzz ? 2 : 1,
            ...(fuzz
              ? {
                  backgroundImage:
                    "repeating-linear-gradient(var(--preview-add) 0 3px, transparent 3px 7px)",
                  WebkitMaskImage: "linear-gradient(to bottom, black, transparent 90%)",
                  maskImage: "linear-gradient(to bottom, black, transparent 90%)",
                }
              : { background: "var(--border)" }),
          }}
        />
      )}
      <span
        className="absolute rounded-full"
        style={{
          ...CENTER,
          top: NODE_TOP,
          marginTop: -(NODE_D / 2),
          width: NODE_D,
          height: NODE_D,
          background: fuzz ? "var(--bg)" : color,
          // The ring in the panel bg punches the dot out of the line behind it.
          border: fuzz ? "1.5px dashed var(--preview-add)" : "2px solid var(--bg)",
        }}
      />
    </div>
  );
}
