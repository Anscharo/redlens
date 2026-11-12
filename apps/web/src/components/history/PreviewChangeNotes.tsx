import { usePreviewDiff, type PreviewDiff } from "../../lib/previewDiff";
import { isReassigned } from "../../lib/identitySwap";
import { diffBaseLabel, type PreviewMeta } from "../../lib/previewMetaCopy";
import { DocNoDiff, TypeDiff } from "./ChangePair";

// The ⚠ glyph renders small for its weight next to 11px mono — size it up 25%.
export const WARN_GLYPH = { fontSize: "1.25em" };

interface PreviewChangeNotesProps {
  nodeId: string;
  meta: PreviewMeta | null;
  source: string;
  hasPatch: boolean;
  status: "Added" | "Changed";
}

/** What the preview diff says about one doc's identity, number and title. */
function docChanges(diff: PreviewDiff, nodeId: string) {
  return {
    // UUID-identity reassignment: this UUID's document was replaced (swap), or
    // this doc holds content that used to live under another UUID (former).
    swap: diff.identitySwap[nodeId],
    former: diff.formerUuid[nodeId],
    // A changed doc that moved: same UUID, new doc number ([live, preview]).
    renumber: diff.renumbered[nodeId],
    // A changed doc whose title differs from the live atlas.
    retitle: diff.retitled[nodeId],
    // A changed doc whose [Type] differs ([live, preview]).
    retype: diff.retyped?.[nodeId],
  };
}

// Prose notes about *how* a doc changed in this preview: the ⚠ identity
// paragraphs (and the plain "rewritten" one for a swap with no sign of where
// the old content went), the renumber and type-change lines, and — when a Changed doc has none
// of those and no line diff either — one neutral fallback sentence. Neutral
// on purpose: the cause may be main having caught up with the branch's edit,
// a raw-only edit the parser normalises away, or a hash-only change — the
// client can't tell these apart, and a bare "Changed" heading with nothing
// under it reads as a bug. A title change is not a note: PreviewDocDiff
// shows it as a word diff above the body diff.
export function PreviewChangeNotes({ nodeId, meta, source, hasPatch, status }: PreviewChangeNotesProps) {
  const diff = usePreviewDiff();
  const { swap, former, renumber, retitle, retype } = docChanges(diff, nodeId);
  // "the live atlas" or "{repo}:{ref}": what the redlines are compared against.
  const label = diffBaseLabel(meta ?? {}, diff.activeBase ?? null);
  const silent = status === "Changed" && !hasPatch && !renumber && !retitle && !retype && !swap;
  return (
    <>
      {/* ⚠ only where the displaced content was found (movedTo). Without that
          the swap is described, not accused — the same rule as PreviewMark. */}
      {isReassigned(swap) && (
        <p className="my-2 leading-snug" style={{ color: "var(--warn)" }}>
          <span style={WARN_GLYPH}>⚠</span> Identity changed — this UUID now holds a different document: “{swap.oldTitle}” <span className="enlargen">→</span> “{swap.newTitle}”.{" "}
          The previous content moved to {swap.movedTo.doc_no} (“{swap.movedTo.title}”) under a new UUID.
        </p>
      )}
      {swap && !isReassigned(swap) && (
        <p className="my-2 leading-snug" style={{ color: "var(--lilac)" }}>
          Rewritten — both the title and the body were replaced: “{swap.oldTitle}” <span className="enlargen">→</span> “{swap.newTitle}”.{" "}
          The previous content was not traced to a single new document in this {source}.
        </p>
      )}
      {former && (
        <p className="my-2 leading-snug" style={{ color: "var(--warn)" }}>
          <span style={WARN_GLYPH}>⚠</span> This content previously appeared under a different UUID — {former.previousId} (“{former.previousTitle}” at {former.previousDocNo}).
        </p>
      )}
      {renumber && (
        <p className="mt-1" style={{ color: "var(--lilac)" }}>
          renumbered <DocNoDiff prev={renumber[0]} next={renumber[1]} />
        </p>
      )}
      {retype && (
        <p className="mt-1" style={{ color: "var(--lilac)" }}>
          type changed <TypeDiff prev={retype[0]} next={retype[1]} />
        </p>
      )}
      {silent && (
        <p className="mt-1" style={{ color: "var(--tan-3)" }}>
          No visible difference from {label}.
        </p>
      )}
    </>
  );
}
