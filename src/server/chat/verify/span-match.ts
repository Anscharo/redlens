// Span matching primitives shared by the refutation judge and its confirm
// gate. A `supported`-style claim used to need this; now it's a CONTRADICTION
// that needs it — the model's `evidence_span` is re-checked here against the
// evidence in code, and the model's `answer_span` is re-checked against the
// answer, so a fabricated contradiction cannot ship on the model's word alone.
import { normalizeForMatch } from "./verify-checks.ts";
import type { EvidenceEntry } from "./verifier.ts";

// Turn `[text](/atlas/uuid)` into `text`, and drop reference-style
// `[label]: /atlas/...` definition lines — the judge sees the RENDERED answer
// (link markup already stripped by normalizeAndRepair upstream in most call
// sites), but the raw model answer passed to validateContradictions may still
// carry markdown, and an `answer_span` copied from the rendered text must
// still match it.
export function stripLinkMarkup(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*\[[^\]]+\]:\s*\/atlas\/\S+\s*$/.test(line))
    .join("\n")
    .replace(/\[([^\]\n]{1,200})\]\([^)\s]*\)/g, "$1");
}

// Word-ish tokens: punctuation dropped, figures kept whole (`0.2%`), naive
// plural strip so `sparks`/`spark` match. Applied identically to both sides.
export function tokenize(s: string): string[] {
  return (s.match(/[a-z0-9]+(?:\.[0-9]+)?%?/g) ?? []).map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t));
}

// Best token-overlap between the span and ANY sliding window of the haystack
// the span's own size — locality is what keeps this honest: words must
// appear TOGETHER, not just somewhere in the same document.
export function spanOverlap(span: string, hay: string): number {
  const s = tokenize(span);
  const h = tokenize(hay);
  if (!s.length || !h.length) return 0;
  const need = new Map<string, number>();
  for (const t of s) need.set(t, (need.get(t) ?? 0) + 1);
  const size = Math.min(h.length, s.length + Math.ceil(s.length * 0.25) + 1);
  const win = new Map<string, number>();
  let matched = 0;
  let best = 0;
  const add = (t: string) => {
    const cur = win.get(t) ?? 0;
    win.set(t, cur + 1);
    if (cur < (need.get(t) ?? 0)) matched++;
  };
  const rm = (t: string) => {
    const cur = win.get(t) ?? 0;
    win.set(t, cur - 1);
    if (cur <= (need.get(t) ?? 0)) matched--;
  };
  for (let i = 0; i < h.length; i++) {
    add(h[i]);
    if (i >= size) rm(h[i - size]);
    if (i >= size - 1) best = Math.max(best, matched / s.length);
  }
  return best;
}

export const SPAN_MATCH_THRESHOLD = 0.8;

// Where the model's `evidence_span` actually lives: exact containment first
// (so a genuine verbatim quote always wins), then the best sliding-window
// overlap across every evidence entry. An empty/whitespace span never counts
// — normalizeForMatch("") is "", and "".includes("") would otherwise score a
// false 1.0 exact match against ANY entry.
export function locateSpan(span: string, evidence: EvidenceEntry[]): { best: number; entryIndex: number } {
  const normSpan = normalizeForMatch(span);
  if (!normSpan) return { best: 0, entryIndex: -1 };
  const hays = evidence.map((e) => normalizeForMatch(e.content));
  for (let i = 0; i < hays.length; i++) {
    if (hays[i].includes(normSpan)) return { best: 1, entryIndex: i };
  }
  let best = 0;
  let entryIndex = -1;
  for (let i = 0; i < hays.length; i++) {
    const s = spanOverlap(normSpan, hays[i]);
    if (s > best) { best = s; entryIndex = i; }
  }
  return { best, entryIndex };
}
