// Evidence narrowing for the Jev refute screen (refute-screen.ts). Pure.
//
// Ported from the 2026-09-22 offline research (docs/plans/jev-typesafe.md
// "Research round 2026-09-22" part 3) without behavioural change, so the
// measured fit / recall numbers apply: each evidence entry is split into
// retrievable records (one per array element / oversized sub-object / 2k-char
// chunk of preview JSON), then a paragraph keeps the records that mention a
// doc it cites plus the top records by IDF-weighted overlap of content words,
// numbers and UUIDs with the paragraph.
import type { AtlasNode, Indexes } from "../../retrieval/indexes.ts";
import type { EvidenceEntry } from "./verifier.ts";
import { extractCitations, contentWords } from "./verify-checks.ts";

export interface EvidenceRecord {
  entry: string; // the evidence label it came from ("[E3]", "[E-const]")
  tool: string;
  path: string; // "(header)" for an entry's scalar fields, else a JSON path
  text: string;
  pos: number; // position in evidence order — ties and final ordering
}

function chunkText(s: string, max = 2000): string[] {
  const parts = s.split(/(?=\{"id":)/);
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    if (cur && cur.length + p.length > max) {
      out.push(cur);
      cur = "";
    }
    cur += p;
    while (cur.length > max) {
      out.push(cur.slice(0, max));
      cur = cur.slice(max);
    }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function walk(v: unknown, p: string, out: { path: string; text: string }[], header: Record<string, unknown>): void {
  if (Array.isArray(v)) {
    if (v.length && v.every((x) => x && typeof x === "object")) {
      v.forEach((x, i) => out.push({ path: `${p}[${i}]`, text: JSON.stringify(x) }));
    } else header[p] = v;
    return;
  }
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const kp = p ? `${p}.${k}` : k;
      if (k === "preview_json" && typeof x === "string") {
        chunkText(x).forEach((c, i) => out.push({ path: `${kp}#${i}`, text: c }));
      } else if (Array.isArray(x) && x.length && x.every((y) => y && typeof y === "object")) walk(x, kp, out, header);
      else if (x && typeof x === "object" && !Array.isArray(x) && JSON.stringify(x).length > 1500) walk(x, kp, out, header);
      else header[kp] = x;
    }
    return;
  }
  header[p || "value"] = v;
}

export function recordsOf(ev: EvidenceEntry[]): EvidenceRecord[] {
  const recs: EvidenceRecord[] = [];
  for (const e of ev) {
    const out: { path: string; text: string }[] = [];
    const header: Record<string, unknown> = {};
    try {
      walk(JSON.parse(e.content), "", out, header);
    } catch {
      chunkText(e.content).forEach((c, i) => out.push({ path: `#${i}`, text: c }));
    }
    const h = JSON.stringify(header);
    if (h.length > 2) recs.push({ entry: e.label, tool: e.tool, path: "(header)", text: h, pos: recs.length });
    for (const o of out) recs.push({ entry: e.label, tool: e.tool, path: o.path, text: o.text, pos: recs.length });
  }
  return recs;
}

const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
// A DELIBERATE narrow dialect of src/lib/patterns.ts's DOC_NO_CORE: "A" only,
// not [A-Z]{1,3}. Every one of the 11,340 documents in the corpus is A.* or
// NR-*, so this matches the same set today; it stays narrow because a loose
// prefix turns ordinary prose capitals into phantom citations. Listed here
// per patterns.ts's request that new dialects say why they exist.
const DOCNO_G = /\bA\.\d+(?:\.\d+)*(?:\.var\d+)?\b|\bNR-\d+\b/g;
const NUM_G = /(?<![0-9a-f-])\d+(?:,\d{3})*(?:\.\d+)?(?![0-9a-f-])/gi;

/**
 * The atlas documents a paragraph cites — by link UUID, or by a doc number it
 * names — read straight from the index, in order of first mention. Tool
 * results can be excerpts; the index holds the whole document.
 */
export function citedDocs(paragraph: string, ix: Indexes): AtlasNode[] {
  const out = new Map<string, AtlasNode>();
  for (const c of extractCitations(paragraph)) {
    const d = ix.docMap.get(c.uuid.toLowerCase());
    if (d) out.set(d.id, d);
  }
  for (const n of paragraph.match(DOCNO_G) ?? []) {
    const d = ix.byDocNo.get(n);
    if (d) out.set(d.id, d);
  }
  return [...out.values()];
}

function citedKeys(paragraph: string, ix: Indexes): string[] {
  const uuids = extractCitations(paragraph).map((c) => c.uuid.toLowerCase());
  const docnos = [...(paragraph.match(DOCNO_G) ?? [])];
  for (const u of uuids) {
    const d = ix.docMap.get(u);
    if (d) docnos.push(d.doc_no);
  }
  return [...new Set([...uuids, ...docnos])];
}

/** Records that mention a doc the paragraph cites (by uuid, or by a doc_no named or cited). */
function citedRecordPositions(paragraph: string, recs: EvidenceRecord[], ix: Indexes): Set<number> {
  const keys = citedKeys(paragraph, ix);
  if (!keys.length) return new Set();
  const hit = (r: EvidenceRecord) =>
    keys.some((k) => (/^[0-9a-f]{8}-/.test(k) ? r.text.toLowerCase().includes(k) : new RegExp(`"${k.replace(/\./g, "\\.")}"`).test(r.text)));
  return new Set(recs.filter(hit).map((r) => r.pos));
}

function termsOf(text: string): string[] {
  const nums = (text.match(NUM_G) ?? []).map((n) => `#${n.replace(/,/g, "")}`);
  const uu = (text.match(UUID_G) ?? []).map((u) => u.toLowerCase());
  return [...new Set([...contentWords(text), ...nums, ...uu])];
}

/**
 * Cited records first (always kept), then records by IDF-weighted term
 * overlap with the paragraph, computed over this turn's own records; zero
 * overlap is never kept. Returned in RANK order (the budget drops from the
 * tail) — at most max(k, cited count) records.
 */
export function rankRecords(paragraph: string, recs: EvidenceRecord[], ix: Indexes, k = 8): EvidenceRecord[] {
  const pTerms = termsOf(paragraph);
  const recTerms = recs.map((r) => new Set(termsOf(r.text)));
  const df = new Map<string, number>();
  for (const s of recTerms) for (const t of s) df.set(t, (df.get(t) ?? 0) + 1);
  const N = recs.length || 1;
  const cited = citedRecordPositions(paragraph, recs, ix);
  const scored = recs.map((r, i) => {
    let s = 0;
    for (const t of pTerms) if (recTerms[i].has(t)) s += Math.log(1 + N / (df.get(t) ?? 1));
    return { r, s: cited.has(r.pos) ? Infinity : s };
  });
  return scored
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.r.pos - b.r.pos)
    .slice(0, Math.max(k, cited.size))
    .map((x) => x.r);
}
