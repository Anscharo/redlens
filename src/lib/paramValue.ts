// Shared low-level parsing helpers for the constraint-parameter extraction
// patterns in paramExtract.ts. Kept separate so paramExtract.ts stays under the
// ~150-line file-size convention. Pure string parsing — no AtlasNode knowledge.

// Multiplier words/suffixes seen in the real corpus ("500 million USDS", "50
// millions sUSDS" — a plural typo in the atlas source, tolerated deliberately).
// Attached-letter suffixes (500M) are UPPERCASE-ONLY: a corpus scan found 266
// lowercase `\d+b` matches that were hex/hash fragments (e.g. "6781594b"), not
// magnitude suffixes — expanding those would be exactly the kind of misparse
// the module is designed to avoid. Uppercase K/M/B/T had zero such collisions
// (4 real occurrences total, all inside a markdown table this module doesn't
// otherwise touch), so it's kept as a narrow, evidence-backed allowance.
const MULTIPLIERS: Record<string, number> = {
  thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12,
  K: 1e3, M: 1e6, B: 1e9, T: 1e12,
};

// A unit word may contain an internal "." (real token symbols like "USDC.e"),
// but a "." can never be its LAST character — that would swallow a sentence-
// final period into the unit (e.g. "- Minimum Positive Participation:
// 240,000,000 SKY." must yield unit "SKY", not "SKY."). Requiring a letter
// after every internal dot draws that line precisely.
const UNIT_WORD = "[A-Za-z][\\w/-]*(?:\\.[A-Za-z][\\w/-]*)*";
const UNIT_TAIL_RE = new RegExp(`^(%|\\s+(?:per\\s+)?${UNIT_WORD}(?:\\s+(?:per\\s+)?${UNIT_WORD}){0,4})?[.,;]?$`);

export interface ParsedValue {
  value: string; // reconstructed canonical string (number + multiplier-as-written + unit)
  num: number | null;
  unit: string | null;
}

// Parses a value token already isolated by a caller (a kv line's RHS, a bare
// core-child body, a prose capture). Anchored both ends — `raw` must be
// *entirely* consumed (number [+ multiplier] [+ unit]) or this returns null.
// That's the precision lever: partial matches (a number embedded in a longer
// non-numeric sentence) are rejected here, not upstream.
//
// Percent convention: "8.75%" parses to num=8.75, unit="%" — NOT num=0.0875.
// Consumers comparing against a stated "8.75%" must compare like-for-like.
export function parseValue(raw: string): ParsedValue | null {
  const s = raw.trim();
  // \d+ first (handles bare multi-digit values with no thousands separators,
  // e.g. reward codes like "2002"), then only well-formed ",DDD" triples
  // extend it — a trailing bare "," (list-item punctuation, e.g. "`tip`: 250,")
  // is correctly left out since it's not followed by exactly 3 digits.
  const numMatch = /^\d+(?:,\d{3})*(?:\.\d+)?/.exec(s);
  if (!numMatch) return null;
  const numStr = numMatch[0];
  let rest = s.slice(numStr.length);
  let mult = 1;
  let multWord = "";
  const attached = /^([KMBT])\b/.exec(rest);
  const spelled = /^\s+(thousand|million|billion|trillion)s?\b/i.exec(rest);
  if (attached) {
    mult = MULTIPLIERS[attached[1]];
    multWord = attached[1];
    rest = rest.slice(attached[0].length);
  } else if (spelled) {
    mult = MULTIPLIERS[spelled[1].toLowerCase()];
    multWord = spelled[0];
    rest = rest.slice(spelled[0].length);
  }
  // Remainder must be exactly: "%" | whitespace + a short unit phrase (<=5
  // words, "per" allowed mid-phrase) | nothing — then optional trailing
  // punctuation from list/sentence context. Anything else fails the whole parse.
  const unitMatch = UNIT_TAIL_RE.exec(rest);
  if (!unitMatch) return null;
  const unitRaw = (unitMatch[1] ?? "").trim();
  const base = parseFloat(numStr.replace(/,/g, ""));
  const num = Number.isFinite(base) ? base * mult : null;
  const value = numStr + multWord + (unitRaw ? (unitRaw === "%" ? "%" : " " + unitRaw) : "");
  return { value, num, unit: unitRaw.length > 0 ? unitRaw : null };
}

// name normalization: lowercased, single-spaced, backtick-stripped, leading
// article and trailing copula dropped ("The GSM Pause Delay is" -> "gsm pause
// delay") — these come from prose captures (kv keys, sentence-template names).
export function normalizeName(raw: string): string {
  let k = raw.trim().replace(/^`|`$/g, "").trim();
  k = k.replace(/^(the|a|an)\s+/i, "");
  k = k.replace(/\s+(is|are|was|were)$/i, "");
  return k.toLowerCase().replace(/\s+/g, " ").trim();
}

export function truncateContext(s: string, max = 160): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + "…";
}

// Fenced code blocks carry raw source literals (Solidity constants, ABI
// values) that aren't atlas "parameters" in the constraint sense — strip them
// before any pattern scans content, so e.g. `require(x <= 887272)` never
// contributes a row.
export function stripCodeFences(content: string): string {
  return content.replace(/```[\s\S]*?```/g, " ");
}
