// Parameter-mismatch hard check (docs/research/synlang-wiki.md §3.1) — the one
// deterministic check that consults the derived parameter table (paramIndex.ts)
// rather than only this turn's evidence, and the largest single check in the
// harness. Split out of verify-checks.ts (which was already past the ~150-line
// convention before it landed) so the citation/quote/number checks and this
// table-driven one stay separately readable; verify-checks.ts re-imports
// findParamMismatches for runDeterministicChecks, and absence.ts consumes
// findParamsMentioned/formatParamValue directly.
//
// A HARD failure: the answer states a WRONG number for a KNOWN atlas
// parameter, with the parameter's name and (if disambiguating) its owner both
// present in the same sentence. Precision over recall throughout — this is a
// hard-fail path.
import type { ParamRow } from "../../../lib/paramIndex.ts";
import type { Indexes } from "../../retrieval/indexes.ts";
import { DOC_NO_CORE } from "../../../lib/patterns.ts";

// Aggressive word tokenization matching paramIndex.ts's own (private)
// normalizeForMatch convention — lowercase, ALL non-alphanumeric collapsed to
// whitespace. Deliberately NOT this file's own `normalizeForMatch` (which
// keeps apostrophes/periods intact for quote-substring matching): that would
// leave "Keel's" as one token and never match a bare "keel" owner/title token.
function paramWords(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean);
}

function ownerTokensOf(owner: string | null): string[] {
  return owner ? paramWords(owner) : [];
}

// A bare single-token name of length <=4 ("max", "cut", "tail", "step") is too
// likely to be an ordinary English word to trust alone — paramIndex.ts's own
// module notes measure exactly these tokens matching 9-22 unrelated rows.
function isGenericRowName(name: string): boolean {
  return !name.includes(" ") && name.length <= 4;
}

export interface ParamMention {
  row: ParamRow;
  byTitle: boolean; // matched via the containing doc's title, not the row's own `name`
}

// Rows whose extracted `name` — OR whose containing doc's TITLE — is fully
// present, as whole normalized words, in `text`, AND (when the row has an
// owner) at least one owner token is present too.
//
// REAL-CORPUS FINDING that motivates the title fallback: `ix.params.matchText`
// alone returns ZERO rows for "Keel's USDS mint maximum is 50,000 USDS" or for
// an absence claim phrased the same way, even though Keel's exact-matching row
// exists (uuid 568f6fae-4680-4090-8eee-fe0b8e920155). The extracted `name` is
// the terse kv key "maxamount" (from a `maxAmount:` line) — it never occurs as
// a literal word in natural paraphrase. The doc's TITLE, "USDS Mint Maximum",
// is what a model actually writes, and IS what appears in the prose.
//
// Both matching paths (literal `name` citation via matchText, and the title
// fallback) are gated against three real-corpus ambiguity sources found by a
// precision sweep (~1000 rows, correct values stated; false positives at each
// stage noted below — see the sweep script referenced in the task report):
//
//   1. NAME collisions: a terse kv key like "maxamount" is reused verbatim
//      across every per-token variant of a templated doc — Keel alone has 30
//      distinct "maxamount" docs. `matchText` on a bare "Keel's `maxAmount`
//      is X" would return ALL 30, and everything but the coincidentally-right
//      one would be flagged wrong (measured: 9 spurious mismatches for one
//      sentence). Gated by `safeNameOwnerUuids`: (name, owner) must resolve
//      to exactly one doc.
//   2. TITLE collisions, two forms: (a) 40/217 (title, owner) keys span
//      MULTIPLE docs (one "Inflow/Deposit/Swap/Outflow Rate Limits" doc PER
//      TOKEN, same title+owner, different maxAmounts); (b) of the remainder,
//      104/177 single-doc keys still bundle several DIFFERENT-valued
//      parameters in one doc (ilk risk docs like "ETH-A" carry chip/cusp/buf/
//      tail/tip/liquidation-ratio together). Gated by `safeTitleOwnerUuids`,
//      keyed on a SORTED (order-independent) word set — two docs whose titles
//      are word-for-word PERMUTATIONS of each other ("...From Ethereum To
//      Avalanche..." vs "...From Avalanche To Ethereum...", a real bridge-
//      direction pair) match the same bag-of-words text either way, so the
//      fan-out check must use the same order-independent key the containment
//      check does, or each direction looks spuriously "unique".
//   3. SUBSET/SUPERSET name collisions: matchText's per-name token-subset
//      semantics mean a SHORTER name's tokens can be fully contained in text
//      that actually names a LONGER, more specific parameter ("smart contract
//      risk rating" ⊂ "...risk rating cap" — both real, different docs).
//      Handled post-hoc below: when two matched names are in a subset
//      relationship, only the longer (more specific) one survives.
//
// All three are fixed at the SOURCE (never added to `out`) or by a final
// subsumption pass — there is no separate opt-in suppression step.
export function findParamsMentioned(text: string, ix: Indexes): ParamMention[] {
  const words = new Set(paramWords(text));
  if (words.size === 0) return [];
  const passOwner = (owner: string | null) => owner === null || ownerTokensOf(owner).some((t) => words.has(t));
  const out: ParamMention[] = [];
  const seen = new Set<string>();

  const safeName = safeNameOwnerUuids(ix);
  const nameMatched = ix.params.matchText(text).filter(
    (row) => !isGenericRowName(row.name) && passOwner(row.owner) && safeName.get(nameOwnerKey(row.name, row.owner)) === row.uuid,
  );
  // Gate 3 (subsumption): among THIS text's name-matched candidates, drop any
  // whose name-token set is a proper subset of another candidate's — the
  // longer, more specific name wins.
  const nameTokenSets = new Map(nameMatched.map((r) => [r, new Set(paramWords(r.name))]));
  for (const a of nameMatched) {
    const ta = nameTokenSets.get(a)!;
    const subsumedByAnother = nameMatched.some((b) => {
      if (b === a) return false;
      const tb = nameTokenSets.get(b)!;
      return ta.size < tb.size && [...ta].every((t) => tb.has(t));
    });
    if (subsumedByAnother) continue;
    seen.add(a.uuid + "|" + a.name);
    out.push({ row: a, byTitle: false });
  }

  const safeTitle = safeTitleOwnerUuids(ix);
  for (const row of ix.params.rows) {
    const key = row.uuid + "|" + row.name;
    // isGenericRowName applies here too, not just to the name-matchText loop —
    // it is a property of the ROW, and title matching is the broader signal.
    if (seen.has(key) || isGenericRowName(row.name) || !passOwner(row.owner)) continue;
    const title = ix.docMap.get(row.uuid)?.title;
    if (!title) continue;
    const titleWords = paramWords(title);
    if (titleWords.join(" ") === row.name) continue; // no new signal over the name check above
    // A single-word title carries the same generic risk isGenericRowName guards
    // against on names — require at least two words for the title signal.
    if (titleWords.length < 2 || !titleWords.every((t) => words.has(t))) continue;
    if (safeTitle.get(titleOwnerKey(titleWords, row.owner)) !== row.uuid) continue; // ambiguous — gate 2
    out.push({ row, byTitle: true });
  }
  return out;
}

function nameOwnerKey(name: string, owner: string | null): string {
  return name + "|" + (owner ?? "");
}

// (name, owner) -> the single doc uuid it's safe to trust a literal name
// citation against — gate 1 above. Every extraction pattern's `name` is
// reused verbatim across per-token/per-vault doc variants far more often than
// it identifies one doc, so this is a strict "exactly one" bar, not a
// num-agreement one (unlike the title gate, a name+owner pins a SPECIFIC
// parameter identity, not a whole doc's worth of siblings).
const nameOwnerSafetyCache = new WeakMap<Indexes, Map<string, string>>();
function safeNameOwnerUuids(ix: Indexes): Map<string, string> {
  const cached = nameOwnerSafetyCache.get(ix);
  if (cached) return cached;
  const uuidsByKey = new Map<string, Set<string>>();
  for (const row of ix.params.rows) {
    const key = nameOwnerKey(row.name, row.owner);
    const s = uuidsByKey.get(key) ?? new Set<string>();
    s.add(row.uuid);
    uuidsByKey.set(key, s);
  }
  const safe = new Map<string, string>();
  for (const [key, uuids] of uuidsByKey) if (uuids.size === 1) safe.set(key, [...uuids][0]);
  nameOwnerSafetyCache.set(ix, safe);
  return safe;
}

// Order-independent (sorted) word-set key — two titles that are word-for-word
// PERMUTATIONS of each other (a real bridge-direction pair, "...From A To
// B..." vs "...From B To A...") must collide here even though their ORIGINAL
// word order differs, because the containment check above is itself
// order-independent (`titleWords.every(t => words.has(t))`): if the fan-out
// key were order-preserving, each direction would look spuriously "unique".
function titleOwnerKey(titleWords: string[], owner: string | null): string {
  return [...titleWords].sort().join(" ") + "|" + (owner ?? "");
}

// (title, owner) -> the single doc uuid it's safe to title-match against —
// gate 2 above. Built from `ix.params.byUuid` — ALL of a doc's rows,
// INCLUDING otherwise-generic ones ("chip", "tip", "step", …): an invisible
// sibling row with a different `num` is still real evidence the title
// doesn't pin down a single value, even though that sibling would never
// itself be reported (isGenericRowName). Cached per Indexes instance since it
// doesn't depend on the text being matched and findParamsMentioned may run
// once per sentence.
const titleOwnerSafetyCache = new WeakMap<Indexes, Map<string, string>>();
function safeTitleOwnerUuids(ix: Indexes): Map<string, string> {
  const cached = titleOwnerSafetyCache.get(ix);
  if (cached) return cached;
  const uuidsByKey = new Map<string, Set<string>>();
  for (const row of ix.params.rows) {
    const title = ix.docMap.get(row.uuid)?.title;
    if (!title) continue;
    const titleWords = paramWords(title);
    if (titleWords.length < 2) continue;
    const key = titleOwnerKey(titleWords, row.owner);
    const s = uuidsByKey.get(key) ?? new Set<string>();
    s.add(row.uuid);
    uuidsByKey.set(key, s);
  }
  const safe = new Map<string, string>();
  for (const [key, uuids] of uuidsByKey) {
    if (uuids.size !== 1) continue; // gate 2a: title+owner must span exactly one doc
    const [uuid] = uuids;
    const nums = new Set((ix.params.byUuid.get(uuid) ?? []).map((r) => r.num));
    if (nums.size === 1) safe.set(key, uuid); // gate 2b: that doc's rows must all agree on num
  }
  titleOwnerSafetyCache.set(ix, safe);
  return safe;
}

interface Mention {
  raw: string; // as written, e.g. "50,000" or "145%"
  num: number; // magnitude-expanded
  pct: boolean; // a "%" sits directly against this number
}

// Local magnitude expansion, parallel to (not importing) paramValue.ts's
// private MULTIPLIERS table: this scans MODEL-WRITTEN prose, not atlas source
// text, so the hex-fragment collision risk that makes paramValue's attached
// letters uppercase-only doesn't apply here — lowercase k/m/b/t is safe.
const MAGNITUDE: Record<string, number> = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12, k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
const MENTION_RE = /\d[\d,]*(?:\.\d+)?(?:\s*(thousand|million|billion|trillion)s?\b|([KMBTkmbt])\b)?(\s*%)?/g;

function extractMentions(sentence: string): Mention[] {
  const out: Mention[] = [];
  for (const m of sentence.matchAll(MENTION_RE)) {
    const numStr = /^\d[\d,]*(?:\.\d+)?/.exec(m[0])![0];
    const base = parseFloat(numStr.replace(/,/g, ""));
    if (!Number.isFinite(base)) continue;
    const magWord = (m[1] || m[2] || "").toLowerCase();
    out.push({ raw: m[0].trim(), num: base * (magWord ? (MAGNITUDE[magWord] ?? 1) : 1), pct: Boolean(m[3]) });
  }
  return out;
}

// True when the sentence already states the row's real value: exact string,
// comma-stripped string, or numeric equality of ANY mention (magnitude-
// expanded) against `row.num` — covers "raised from 5,000 to 10,000" style
// sentences that also mention an old/wrong figure alongside the real one.
function sentenceHasTrueValue(sentence: string, row: ParamRow, mentions: Mention[]): boolean {
  const lower = sentence.toLowerCase();
  if (lower.includes(row.value.toLowerCase())) return true;
  if (lower.replace(/,/g, "").includes(row.value.toLowerCase().replace(/,/g, ""))) return true;
  return row.num !== null && mentions.some((m) => m.num === row.num);
}

function splitAnswerSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

// The brief describes a two-phase design (a coarse whole-answer candidate
// filter, then a per-sentence refinement). This runs the token+owner
// containment check directly per sentence via findParamsMentioned instead —
// outcome-equivalent (a row is only ever flagged when some sentence satisfies
// both conditions) and avoids maintaining two separate candidate-selection
// code paths for one property.
// One detected mismatch, structured rather than pre-formatted. The advisor
// steer wants a sentence (formatParamMismatch below), but the SSE badge wants
// the parts: `title` + `uuid` let the client link the parameter's document
// instead of printing a bare doc_no, and `name` — the terse extracted kv key
// ("maxamount") — is machine vocabulary that should never reach a reader on
// its own. Kept anyway because the advisor prompt names it, which is how the
// model finds the value it got wrong.
export interface ParamMismatch {
  stated: string; // the number as the answer wrote it
  actual: string; // our extraction's value, unit-formatted
  name: string; // extracted kv key — advisor-facing
  title: string; // containing doc's title — reader-facing
  owner: string | null;
  uuid: string;
  doc_no: string;
}

// The advisor steer sentence. Wording is load-bearing for the recovery prompt —
// it names the exact figure to correct — so it stays as it was when this was
// the only representation.
export function formatParamMismatch(m: ParamMismatch): string {
  const owner = m.owner ? ` (${m.owner})` : "";
  return `answer states ${m.stated} for ${m.name}${owner} but the atlas value is ${m.actual} — ${m.doc_no}`;
}

export function findParamMismatches(answer: string, ix: Indexes): ParamMismatch[] {
  // Strip link hrefs (uuid digits) and doc-no mentions before scanning for
  // numbers — same digit-noise reasoning as findUntracedNumbers above.
  // Backticks are NOT stripped: a model faithfully echoing the atlas's own
  // `` `maxAmount` `` kv-key syntax must stay visible to the name-token check.
  const prose = answer.replace(/\]\([^)]*\)/g, "]").replace(new RegExp(String.raw`\b${DOC_NO_CORE}\b`, "g"), "");
  // Keyed by the formatted sentence so dedupe behaviour is exactly what it was
  // when this returned strings — the same figure restated across sentences
  // collapses to one entry.
  const out = new Map<string, ParamMismatch>();
  for (const sentence of splitAnswerSentences(prose)) {
    const mentions = extractMentions(sentence);
    if (mentions.length === 0) continue; // no number stated — nothing to check
    for (const { row } of findParamsMentioned(sentence, ix)) {
      if (sentenceHasTrueValue(sentence, row, mentions)) continue;
      let relevant = mentions;
      if (row.unit === "%") {
        // Unit-mismatch gate: a % parameter's sentence must carry a %-adjacent
        // number, or its numbers are probably a different quantity entirely.
        relevant = mentions.filter((m) => m.pct);
        if (relevant.length === 0) continue;
      } else if (row.unit && !sentence.toLowerCase().includes(row.unit.toLowerCase())) {
        continue; // non-% unit's text absent from the sentence — likely unrelated
      }
      for (const m of relevant.filter((m) => !(row.num !== null && m.num === row.num))) {
        const mismatch: ParamMismatch = {
          stated: m.raw,
          actual: formatParamValue(row),
          name: row.name,
          // Falls back to the kv key only if the doc vanished from the index
          // between the param build and this check — shouldn't happen (both
          // derive from the same buildIndexes pass), but a missing title must
          // not drop an otherwise-valid hard failure.
          title: ix.docMap.get(row.uuid)?.title ?? row.name,
          owner: row.owner,
          uuid: row.uuid,
          doc_no: row.doc_no,
        };
        out.set(formatParamMismatch(mismatch), mismatch);
      }
    }
  }
  return [...out.values()];
}

// `value` usually embeds its unit already ("10,000 USDS" with unit "USDS");
// append `unit` only when it doesn't, so messages never read "10,000 USDS USDS".
// Shared by the mismatch strings above and absence.ts's refutation detail.
export function formatParamValue(p: { value: string; unit: string | null }): string {
  if (!p.unit || p.value.toLowerCase().endsWith(p.unit.toLowerCase())) return p.value;
  return p.unit === "%" ? `${p.value}%` : `${p.value} ${p.unit}`;
}
