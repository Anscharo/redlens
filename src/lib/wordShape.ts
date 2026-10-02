// Does a string look like an English word? Pure spelling-shape rules, no
// dictionary, so nothing here needs to track the atlas or a word list.
//
// The meaning lane uses it as a gate: a query token that is neither a term the
// atlas index holds nor word-shaped (a keyboard slip, a half-pasted hash, a
// letter-number jumble) is not worth an embedding call. The rules err toward
// "fine": a false hold costs the reader one Enter, a false pass costs one embed.

// Letter pairs English spelling does not produce inside a word. `q` is handled
// separately (it needs a following `u`, `a` or `i`, or must end the word).
const IMPOSSIBLE_BIGRAMS: readonly string[] = [
  "jq", "jx", "jz", "qj", "vq", "vx", "vj", "vz", "wx", "wq", "wz", "xj", "xz", "xk",
  "zx", "zq", "zj", "fq", "fx", "fz", "gq", "gx", "hx", "kq", "kx", "kz", "mq", "mx",
  "pq", "px", "bq", "bx", "bz", "cx", "dx", "lq", "sx", "tq", "yq",
];

const VOWEL_RE = /[aeiouy]/;
const TRIPLE_RE = /([a-z0-9])\1\1/;
const CONSONANT_RUN_RE = /[^aeiouy0-9_]{7,}/;
// Digits with a one- or two-letter tail ("2nd", "10x", "24h"), or a single
// letter then digits ("v2", "l2"): the shapes figures and versions take.
const FIGURE_SHAPE_RE = /^(?:\d+[a-z]{1,2}|[a-z]\d+)$/;
const TOKEN_RE = /[\p{L}\p{N}_]+/gu;

/** Judges one token; a token under two characters is never held. */
export function looksLikeWord(token: string): boolean {
  const t = token.toLowerCase();
  if (t.length < 2) return true;
  // Another script, or an identifier with `_`: not judged by English spelling.
  if (!/^[a-z0-9]+$/.test(t)) return true;
  if (/^\d+$/.test(t)) return true;
  if (/\d/.test(t)) return FIGURE_SHAPE_RE.test(t);
  if (!VOWEL_RE.test(t)) return false;
  if (TRIPLE_RE.test(t)) return false;
  if (CONSONANT_RUN_RE.test(t)) return false;
  if (/q(?![uai]|$)/.test(t)) return false;
  return !IMPOSSIBLE_BIGRAMS.some((b) => t.includes(b));
}

/**
 * The tokens of `text` that are neither an indexed term nor word-shaped, in
 * order and without repeats. `text` is what the lane would embed, so syntax and
 * `in:` scopes are already gone. Splitting keeps `_` inside a token, as the
 * lexical side does.
 */
export function heldWords(text: string, isIndexed: (token: string) => boolean): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of text.match(TOKEN_RE) ?? []) {
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (!looksLikeWord(token) && !isIndexed(token)) out.push(token);
  }
  return out;
}
