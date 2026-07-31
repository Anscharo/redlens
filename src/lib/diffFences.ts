// Fenced-code-block tracking across a diff. `isStructuredLine`
// (./diffSentences) classifies a line in isolation, so a fenced block whose
// contents are ordinary words ("```\nsome plain text\n```") matches only on
// its ``` delimiters and its contents fall through to the prose treatment. A
// fence is a block construct, so that decision has to be carried down the
// lines instead. Pure, no React — the display refinement (./diffProse) and the
// renderer (components/history/DiffView) read the same flags, so a line's font
// agrees with how its diff was computed.

import type { DiffLine, WordSegment } from "./history";

const FENCE_RE = /^\s*```/;

/** Old- and new-side text of one diff entry; `null` on a side the entry does
 *  not exist on ("+" is new-only, "-" old-only; a "~" interleaves both).
 *  Tolerant of a malformed payload — a stored diff can arrive with a "~"
 *  whose segments aren't segments at all; such an entry simply has no sides
 *  and leaves the fence state alone. */
function sides(line: DiffLine): [string | null, string | null] {
  const op = line[0];
  const text = typeof line[1] === "string" ? (line[1] as string) : null;
  if (op === "=") return [text, text];
  if (op === "-") return [text, null];
  if (op === "+") return [null, text];
  if (op === "~" && Array.isArray(line[1])) {
    const segs = line[1] as WordSegment[];
    const side = (keep: string) =>
      segs
        .filter((s) => Array.isArray(s) && (s[0] === "=" || s[0] === keep))
        .map((s) => (typeof s[1] === "string" ? s[1] : ""))
        .join("");
    return [side("-"), side("+")];
  }
  return [null, null]; // "…" gap marker (or a malformed entry)
}

/** Per-line "is part of a fenced code block" flags, aligned 1:1 with `lines`
 *  (the ``` delimiter rows included, so a block and its fences read as one
 *  unit). Fence state is tracked per side — a "-" line toggles only the old
 *  document's fence, a "+" only the new one — so a diff that edits the
 *  delimiter row itself doesn't toggle twice and invert the rest of the block.
 *
 *  Best-effort by construction: a stored diff keeps only ±2 lines of context
 *  (`trimContext` in ./diffCore), so an opening ``` can sit in an elided region
 *  and never be seen. A "…" gap therefore leaves the state as it was — at
 *  worst that carries an open fence past the gap and over-applies monospace,
 *  which is the direction this classifier should err in. */
export function fencedFlags(lines: DiffLine[]): boolean[] {
  if (!Array.isArray(lines)) return [];
  const flags: boolean[] = [];
  let inOld = false;
  let inNew = false;
  for (const line of lines) {
    if (!Array.isArray(line)) {
      flags.push(false);
      continue;
    }
    const [oldText, newText] = sides(line);
    const oldFence = oldText !== null && FENCE_RE.test(oldText);
    const newFence = newText !== null && FENCE_RE.test(newText);
    flags.push(
      oldFence || newFence || (oldText !== null && inOld) || (newText !== null && inNew),
    );
    if (oldFence) inOld = !inOld;
    if (newFence) inNew = !inNew;
  }
  return flags;
}
