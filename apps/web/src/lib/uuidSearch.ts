import { UUID_PREFIX_RE } from "@/lib/patterns";

// Partial-UUID search: let people paste a UUID fragment (the 8-hex first segment
// is what most tools surface) and jump straight to the doc, without needing the
// full 36-char UUID. The worker scans doc ids directly — the MiniSearch index
// does not tokenize the id field — so this is a separate fast-path from
// full-text search, with fall-through when nothing matches.

/** True when `q` looks like a partial UUID (a prefix of a full uuid). */
export function isUuidPrefix(q: string): boolean {
  return UUID_PREFIX_RE.test(q);
}

/** Doc ids whose UUID begins with `frag` (case-insensitive). Empty when none —
 *  the caller then falls through to full-text search, so a hex-ish word that
 *  isn't actually a UUID prefix still searches content. */
export function matchUuidPrefix(frag: string, ids: Iterable<string>): string[] {
  const f = frag.toLowerCase();
  const out: string[] = [];
  for (const id of ids) if (id.startsWith(f)) out.push(id);
  return out;
}
