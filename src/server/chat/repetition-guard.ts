// Deterministic handbrake for answer streams that collapse into repetition
// (e.g. "aaaaaaaa…", "the same as the same as…", "a a a a…"). Pure string
// check — no model in the loop. Tuned against observed 2026-08-06 degenerations;
// thresholds stay high enough that normal prose / short lists do not trip it.

const MIN_CHARS = 96;
const CHAR_WINDOW = 120;
const CHAR_MIN_RUN = 48;
const CHAR_DOMINANCE = 0.72;

const PHRASE_TAIL = 480;
const PHRASE_UNIT_MIN = 4;
const PHRASE_UNIT_MAX = 48;
const PHRASE_MIN_REPEATS = 6;
const PHRASE_MIN_SPAN = 72; // repeats × unitLen

/** True when `text` has entered a character- or phrase-level repetition loop. */
export function isRepetitionLoop(text: string): boolean {
  if (text.length < MIN_CHARS) return false;
  return hasDominatingCharRun(text) || hasRepeatingPhrase(text);
}

// Same alphanumeric glyph flooding the recent window — covers "aaaaaaaa",
// "A A A A A", and "a a a a a". Punctuation-only floods (markdown table
// rules, dividers) are ignored so a wide `|---|` answer cannot trip the
// handbrake.
function hasDominatingCharRun(text: string): boolean {
  const window = text.slice(-CHAR_WINDOW);
  const letters = window.replace(/[^a-zA-Z0-9]/g, "");
  if (letters.length < CHAR_MIN_RUN) return false;
  const counts = new Map<string, number>();
  let max = 0;
  for (const ch of letters) {
    const n = (counts.get(ch) ?? 0) + 1;
    counts.set(ch, n);
    if (n > max) max = n;
  }
  return max >= CHAR_MIN_RUN && max / letters.length >= CHAR_DOMINANCE;
}

// A short unit repeating consecutively at the end — covers
// "the same as the same as the same as…".
function hasRepeatingPhrase(text: string): boolean {
  const tail = text.slice(-PHRASE_TAIL);
  const maxUnit = Math.min(PHRASE_UNIT_MAX, Math.floor(tail.length / PHRASE_MIN_REPEATS));
  for (let unitLen = PHRASE_UNIT_MIN; unitLen <= maxUnit; unitLen++) {
    const unit = tail.slice(-unitLen);
    if (!/[a-zA-Z0-9]/.test(unit)) continue; // skip pure punctuation/whitespace units
    let repeats = 0;
    let pos = tail.length;
    while (pos >= unitLen && tail.slice(pos - unitLen, pos) === unit) {
      repeats++;
      pos -= unitLen;
    }
    if (repeats >= PHRASE_MIN_REPEATS && repeats * unitLen >= PHRASE_MIN_SPAN) return true;
  }
  return false;
}
