import type { FormerUuid, IdentitySwap } from "../../lib/previewDiff";

// The ⚠ glyph renders small for its weight next to 11px mono — size it up 25%.
export const WARN_GLYPH = { fontSize: "1.25em" };

interface PreviewChangeNotesProps {
  swap?: IdentitySwap;
  former?: FormerUuid;
  renumber?: [string, string];
  retitle?: [string, string];
  source: string;
  hasPatch: boolean;
  status: "Added" | "Changed";
}

// Prose notes about *how* a doc changed in this preview: the ⚠ identity
// paragraphs, the renumber/retitle lines, and — when a Changed doc has none
// of those and no line diff either — one neutral fallback sentence. Neutral
// on purpose: the cause may be main having caught up with the branch's edit,
// a raw-only edit the parser normalises away, or a hash-only change — the
// client can't tell these apart, and a bare "Changed" heading with nothing
// under it reads as a bug.
export function PreviewChangeNotes({ swap, former, renumber, retitle, source, hasPatch, status }: PreviewChangeNotesProps) {
  const silent = status === "Changed" && !hasPatch && !renumber && !retitle && !swap;
  return (
    <>
      {swap && (
        <p className="my-2 leading-snug" style={{ color: "var(--warn)" }}>
          <span style={WARN_GLYPH}>⚠</span> Identity changed — this UUID now holds a different document: “{swap.oldTitle}” <span className="enlargen">→</span> “{swap.newTitle}”.{" "}
          {swap.movedTo
            ? `The previous content moved to ${swap.movedTo.doc_no} (“${swap.movedTo.title}”) under a new UUID.`
            : `The previous content is not present in this ${source}.`}
        </p>
      )}
      {former && (
        <p className="my-2 leading-snug" style={{ color: "var(--warn)" }}>
          <span style={WARN_GLYPH}>⚠</span> This content previously appeared under a different UUID — {former.previousId} (“{former.previousTitle}” at {former.previousDocNo}).
        </p>
      )}
      {renumber && (
        <p className="mt-1" style={{ color: "var(--lilac)" }}>
          renumbered {renumber[0]}{" "}
          <span className="enlargen">→</span> {renumber[1]}
        </p>
      )}
      {/* A swap's ⚠ paragraph already carries the old → new title; a second
          "retitled" line under it would repeat the same two strings. */}
      {retitle && !swap && (
        <p className="mt-1" style={{ color: "var(--lilac)" }}>
          retitled “{retitle[0]}”{" "}
          <span className="enlargen">→</span> “{retitle[1]}”
        </p>
      )}
      {silent && (
        <p className="mt-1" style={{ color: "var(--tan-3)" }}>
          No visible difference from the live atlas.
        </p>
      )}
    </>
  );
}
