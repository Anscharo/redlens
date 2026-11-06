// Changed docs whose only change is their doc number: same title, and a body
// that matches once every doc number it mentions is read through this
// preview's renumbering. A parent moving renumbers its whole subtree, and the
// children's bodies often cite their siblings ("per A.1.2.3"), so a strict
// body comparison would call every one of them edited.
//
// The reader's Exclude › "Renumber-only changes" filter reads this list; patches are loaded
// lazily, so the browser cannot work it out itself.
import type { Snapshot, SnapshotDoc } from "./snapshot.ts";

// Same shape the votes subject parser uses for doc numbers in prose: a scope
// letter, dotted segments, ending on a digit (so a trailing full stop is not
// swallowed), or a Needed Research number.
const DOC_NO_IN_TEXT_RE = /\b(?:[A-Z]\.[\w.]*\d|NR-\d+)\b/g;

interface Sides {
  before: (id: string) => SnapshotDoc | undefined;
  after: (id: string) => SnapshotDoc | undefined;
}

/** old doc number → new, over every changed doc that moved. One pass of
 *  replacement through this map handles swaps (A.1 ⇄ A.2) correctly. */
function renumberMap(changed: string[], { before, after }: Sides): Map<string, string> {
  const map = new Map<string, string>();
  for (const id of changed) {
    const b = before(id);
    const a = after(id);
    if (b && a && b.doc_no !== a.doc_no) map.set(b.doc_no, a.doc_no);
  }
  return map;
}

export function findRenumberedOnly(changed: string[], sides: Sides): string[] {
  const moves = renumberMap(changed, sides);
  if (!moves.size) return [];
  const rewrite = (text: string) => text.replace(DOC_NO_IN_TEXT_RE, (m) => moves.get(m) ?? m);
  const out: string[] = [];
  for (const id of changed) {
    const b = sides.before(id);
    const a = sides.after(id);
    if (!b || !a || b.doc_no === a.doc_no || b.title !== a.title) continue;
    const bodyBefore = b.content ?? "";
    const bodyAfter = a.content ?? "";
    if (bodyBefore === bodyAfter || rewrite(bodyBefore) === bodyAfter) out.push(id);
  }
  return out;
}

/** The before/after pair computeDiffArtifacts compares a changed doc across:
 *  the reference snapshot, else the merge base, against the head. */
export function diffSides(base: Snapshot, head: Snapshot, reference: Snapshot): Sides {
  return { before: (id) => reference.get(id) ?? base.get(id), after: (id) => head.get(id) };
}
