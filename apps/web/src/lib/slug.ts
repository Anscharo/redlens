// github-slugger-style heading/term ids: lowercase, strip punctuation, spaces
// become hyphens; a within-document repeat gets an incrementing -1, -2, …
// suffix rather than colliding with the first occurrence.
const STRIP_RE = /[^\p{Letter}\p{Number}\s-]+/gu;

export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(STRIP_RE, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Stateful per-document slugger — share one instance across every heading
 *  in a document (in source order) so repeats dedupe against each other. */
export function makeSlugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = slugify(text) || "section";
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  };
}
