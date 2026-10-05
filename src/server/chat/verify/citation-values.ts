// A citation whose LINK TEXT is a value — a number, percentage, date, or
// on-chain address — is the sharpest wrong-doc signal available in pure code.
// A value cannot be paraphrased, so if the answer writes `[5%][spark-rate]` the
// figure 5% must literally occur in the spark-rate doc; citing a doc that does
// not contain it is misattribution, a HARD failure on the same reasoning as
// `findUngroundedAddresses`. The escape hatch for "plainly computed" values
// (a total the answer derives from cited parts, which lives in no single doc):
// a value that appears in NO tool evidence at all is left to
// `findUntracedNumbers` (soft) and never hard-failed here — only a value that
// IS in this turn's evidence but NOT in the cited doc is flagged, which is
// exactly a real figure attributed to the wrong document. Percentages and
// decimals are examined even when small — unlike `findUntracedNumbers`'s ≤20
// integer skip — because a bare `5%` is precisely the gap this closes.
// Complements the per-citation Jev check (citation-marks.ts), which judges
// prose sentences against the doc they cite; this scores citations whose text
// IS the claim, in code, where an exact value match is better than a model.
import { UUID_RE, EVM_ADDRESS_SRC, SOL_ADDRESS_SRC, DOC_NO_CORE } from "../../../lib/patterns.ts";
import type { Indexes } from "../../retrieval/indexes.ts";
import { extractCitations } from "./citation-links.ts";
import { NUMBER_RE, SMALL_COUNT_MAX } from "./value-grounding.ts";

const PERCENT_RE = /\d[\d,]*(?:\.\d+)?\s*%/g;
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g;
const SLASH_DATE_RE = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g;

// Comma/percent-form-insensitive numeric key: thousands separators drop on both
// sides (`10,782` ↔ `10782`) and `5 %` collapses to `5%`, so a normalized value
// matches the same figure however the doc spells its separators.
const numKey = (s: string) => s.replace(/,(?=\d{3}\b)/g, "").replace(/\s+%/g, "%").toLowerCase();

// Whether a normalized numeric key occurs in `hayNum` as a whole figure rather
// than a digit-substring of a larger one. A plain `includes` treats `[5%]` cited
// to a doc that only says `15%` as grounded — suppressing the wrong-doc HARD
// failure this check exists to raise — because "15%" contains "5%". Guard both
// ends against an adjacent digit or decimal point so `5%`≠`15%`, `48.73`≠`148.73`
// or `48.731`, and a date's components don't collide with a longer run.
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const numTokenInHay = (hayNum: string, key: string): boolean =>
  key.length > 0 && new RegExp(String.raw`(?<![\d.])${escapeRe(key)}(?![\d.])`).test(hayNum);

interface LinkValue {
  literal: string;
  address: "evm" | "sol" | null;
}

// Every value literal in link text, most-distinctive-first (addresses, then
// percentages, then dates, then remaining figures), each span blanked out
// before the next scan so a percentage's or address's own digits are never
// re-mined as a bare number.
function minedLinkValues(text: string): LinkValue[] {
  // A leading real/structural doc_no in the link text ("A.2.2.9 - Rate") is an
  // identifier, not a value — drop it before mining. So is a UUID: a model that
  // writes a doc's own uuid as link text (`[7ac692f1-9829-41d8-…](/atlas/7ac692f1-…)`)
  // would otherwise yield digit runs — 692, 9829, 41 — short enough to occur
  // incidentally in some other retrieved doc and be reported as figures
  // misattributed to the doc they link.
  let rest = text.replace(new RegExp(String.raw`^\s*${DOC_NO_CORE}\b`), "");
  rest = rest.replace(new RegExp(UUID_RE.source.slice(1, -1), "gi"), " ");
  const out: LinkValue[] = [];
  for (const m of rest.match(new RegExp(EVM_ADDRESS_SRC, "g")) ?? []) out.push({ literal: m, address: "evm" });
  for (const m of rest.match(new RegExp(SOL_ADDRESS_SRC, "g")) ?? []) out.push({ literal: m, address: "sol" });
  rest = rest.replace(new RegExp(EVM_ADDRESS_SRC, "g"), " ").replace(new RegExp(SOL_ADDRESS_SRC, "g"), " ");
  for (const re of [PERCENT_RE, ISO_DATE_RE, SLASH_DATE_RE]) {
    for (const m of rest.match(re) ?? []) out.push({ literal: m, address: null });
  }
  rest = rest.replace(PERCENT_RE, " ").replace(ISO_DATE_RE, " ").replace(SLASH_DATE_RE, " ");
  for (const m of rest.match(NUMBER_RE) ?? []) {
    const n = Number(m.replace(/,/g, ""));
    if (!Number.isFinite(n)) continue;
    if (Number.isInteger(n) && Math.abs(n) <= SMALL_COUNT_MAX) continue;
    out.push({ literal: m, address: null });
  }
  return out;
}

// Values carried by a citation's link text, deduped on their match key in
// mining order. Exported so the model bakeoff can measure the prompt-compliance
// rate for "make the value the link text" — the behaviour
// findUngroundedCitationValues depends on (see docs/plans/reference-citations.md).
export function citationValues(text: string): LinkValue[] {
  const out: LinkValue[] = [];
  const seen = new Set<string>();
  for (const v of minedLinkValues(text)) {
    const key = v.address ? v.literal : numKey(v.literal);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

interface Hay {
  raw: string;
  lower: string;
  num: string;
}
const mkHay = (s: string): Hay => ({ raw: s, lower: s.toLowerCase(), num: numKey(s) });

// EVM matching is case-insensitive (checksum casing is cosmetic); base58 Solana
// is case-sensitive; numeric values compare on the comma/percent-normalized key.
function valueInHay(v: LinkValue, hay: Hay): boolean {
  if (v.address === "evm") return hay.lower.includes(v.literal.toLowerCase());
  if (v.address === "sol") return hay.raw.includes(v.literal);
  return numTokenInHay(hay.num, numKey(v.literal));
}

export function findUngroundedCitationValues(answer: string, evidenceTexts: string[], ix: Indexes): string[] {
  const cites = extractCitations(answer);
  if (cites.length === 0) return [];
  const evidence = mkHay(evidenceTexts.join("\n"));
  const out: string[] = [];
  for (const c of cites) {
    const doc = ix.docMap.get(c.uuid);
    if (!doc) continue; // an unknown uuid is already a hard failure
    const docHay = mkHay(`${doc.title}\n${doc.content}`);
    for (const v of citationValues(c.title)) {
      if (valueInHay(v, docHay)) continue; // grounded in the cited doc — fine
      if (!valueInHay(v, evidence)) continue; // in no evidence at all → computed/soft, skip
      out.push(`${v.literal} cited to ${doc.doc_no} (${doc.title}) but absent from it`);
    }
  }
  return [...new Set(out)];
}

// Settlement-cycle figures attributed to the atlas. Scoped PER VALUE against
// the MSC brief, not by citation shape and not by "does the cited atlas doc
// also mention these digits":
//   - `[10,000,000 USDS](/atlas/<uuid>)` is how system-prompt.ts tells the
//     model to cite a genuine atlas debt ceiling. That citation stays clean
//     on a mixed process+figures turn as long as 10,000,000 is not in the
//     MSC brief.
//   - Spark's To Sky cited as `/atlas/…` fails because 5,000,000 IS in the
//     brief — even if the cited atlas doc happens to contain the same digits
//     (findUngroundedCitationValues would skip that collision as "grounded").
// Shape-only matching (any `$n` / `n USDS` link text once MSC ran) would
// hard-fail correct atlas citations, putting a fail badge on an answer that
// cited a real atlas fact correctly.
export function findMscCitedAsAtlas(answer: string, externalTexts: string[], ix: Indexes): string[] {
  const cites = extractCitations(answer);
  if (cites.length === 0 || externalTexts.length === 0) return [];
  const external = mkHay(externalTexts.join("\n"));
  const out: string[] = [];
  for (const c of cites) {
    const doc = ix.docMap.get(c.uuid);
    if (!doc) continue; // an unknown uuid is already a hard failure
    for (const v of citationValues(c.title)) {
      if (!valueInHay(v, external)) continue; // not a settlement figure — other checks own it
      out.push(`${v.literal} cited as /atlas/${c.uuid} (${doc.doc_no}) but comes from the external settlement brief`);
    }
  }
  return [...new Set(out)];
}
