// The lexical baseline and prefilter for the vote-evidence eval's poll task:
// TF-IDF cosine between a claim and each candidate poll. It is the research's
// "K5" key (docs/plans/vote-matching.md §4), kept here as the arm the judges
// must beat and as the cut that decides what they see. Pure.

const STOP = new Set(
  "the and for with from that this these those will shall must may are was were been have has its into per via any all each such which who".split(" "),
);

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []).filter((t) => !STOP.has(t));
}

function counts(ts: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of ts) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

/** Indices of `docs`, most similar to `query` first; ties keep document order. */
export function rankLexically(query: string, docs: readonly string[]): number[] {
  const docCounts = docs.map((d) => counts(tokens(d)));
  const df = new Map<string, number>();
  for (const c of docCounts) for (const t of c.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log((docs.length + 1) / ((df.get(t) ?? 0) + 1)) + 1;
  const vec = (c: Map<string, number>) => new Map([...c].map(([t, n]) => [t, n * idf(t)]));
  const norm = (v: Map<string, number>) => Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0)) || 1;
  const q = vec(counts(tokens(query)));
  const qn = norm(q);
  const score = docCounts.map((c) => {
    const v = vec(c);
    let dot = 0;
    for (const [t, w] of q) dot += w * (v.get(t) ?? 0);
    return dot / (qn * norm(v));
  });
  return docs.map((_, i) => i).sort((a, b) => score[b] - score[a] || a - b);
}
