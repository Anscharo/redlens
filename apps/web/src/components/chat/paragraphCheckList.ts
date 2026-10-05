import type { ParagraphCheck } from "./chatTypes";

// Upsert by `index`, inserting in index order in case a check arrives out of order.
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

// "pending" and "candidate" must not outlive the verdict (no refute may ever
// come; confirm resolves at verify_result). `model` is removed, not set
// terminal: nothing failed, and ParagraphChecks renders no mark without it.
export function clearInFlightModelMarks<T extends ParagraphCheck[] | undefined>(list: T): T {
  if (!list || !list.some((c) => c.model === "pending" || c.model === "candidate")) return list;
  return list.map((c) => {
    if (c.model !== "pending" && c.model !== "candidate") return c;
    const { model: _inFlight, ...rest } = c;
    return rest;
  }) as T;
}
