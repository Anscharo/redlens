// Which parts of a doc number a renumbering changed, segment by segment. A doc
// number is dotted segments (`A.1.2.3`, `A.1.0.3.2`, `A.1.var2`), so the
// comparison is per segment, never per character: `A.1.10` → `A.1.1` changes
// the last segment, it does not drop a trailing `0`.

/** One dotted segment of a doc number, and whether the renumbering changed it. */
export interface DocNoSegment {
  text: string;
  changed: boolean;
}

/** Both sides of a renumbering. The segments the two share at the start and at
 *  the end are unchanged; everything between is changed on each side. */
export function docNoDiff(prev: string, next: string): { prev: DocNoSegment[]; next: DocNoSegment[] } {
  const a = prev.split(".");
  const b = next.split(".");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const mark = (segs: string[]) =>
    segs.map((text, i) => ({ text, changed: i >= head && i < segs.length - tail }));
  return { prev: mark(a), next: mark(b) };
}
