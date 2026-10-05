import type { ParagraphCheck } from "./chatTypes";

// Upsert by `index`: a re-emitted index replaces that entry in place,
// otherwise the new check is inserted in index order (checks normally arrive
// in order, but this keeps rendering correct even if one is ever re-sent
// out of order).
export function upsertParagraphCheck(list: ParagraphCheck[], check: ParagraphCheck): ParagraphCheck[] {
  const i = list.findIndex((c) => c.index === check.index);
  if (i !== -1) {
    const next = list.slice();
    next[i] = check;
    return next;
  }
  const insertAt = list.findIndex((c) => c.index > check.index);
  if (insertAt === -1) return [...list, check];
  return [...list.slice(0, insertAt), check, ...list.slice(insertAt)];
}

// In-flight model states that must not outlive the verdict:
//   - "pending"   — refute submitted, no `paragraph_refute` yet. In
//                   `answer` mode (or against an older build) none ever
//                   arrives; a hollow pending mark after the verdict
//                   misreads as "still running" rather than "it never ran".
//   - "candidate" — refute found ≥1 candidate, still under the confirm
//                   gate. Confirm resolves at `verify_result`; leaving the
//                   mark would say "possible contradiction, being confirmed"
//                   next to a finished badge (green or red). Agreed
//                   contradictions live on the chip; unagreed ones must
//                   not keep speaking.
// `model` is REMOVED, not set to "failed"/"ok": nothing failed, the
// in-flight step simply ended. `ok` and `failed` are already terminal and
// stay. `ParagraphChecks` renders no mark at all when `model` is undefined.
export function clearInFlightModelMarks<T extends ParagraphCheck[] | undefined>(list: T): T {
  if (!list || !list.some((c) => c.model === "pending" || c.model === "candidate")) return list;
  return list.map((c) => {
    if (c.model !== "pending" && c.model !== "candidate") return c;
    const { model: _inFlight, ...rest } = c;
    return rest;
  }) as T;
}
