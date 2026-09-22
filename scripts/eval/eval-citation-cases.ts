// Case builder for the A1 citation-support bakeoff (eval-citation.ts).
//
// POSITIVES are the real citations in the stored corpora: sentences a chat
// model actually wrote, each paired with the doc it actually linked. They are
// the false-flag denominator, and that is the number the decision turns on —
// a check that flags correct citations is noise no matter how many wrong ones
// it catches.
//
// NEGATIVES are built by REPOINTING a real sentence at a different document,
// which keeps the prose real and makes the label certain. Five classes, in
// rising order of how hard they are to see lexically:
//   random         — an unrelated doc. Any check should catch this.
//   parent         — the cited doc's own parent. Since atomization a parent's
//                    content does not contain its children's text, so this is
//                    a genuine misattribution, and it is also the case most
//                    likely to be a FALSE alarm on a correct citation.
//   sibling        — another child of the same parent: same topic, same
//                    vocabulary, different subject.
//   same_title     — a different doc with the IDENTICAL title (the atlas has
//                    142 "Rate Limits", one per agent). Word overlap is near
//                    perfect, so the lexical check is blind here by
//                    construction. This is the class the whole check is for.
//   cited_elsewhere — a doc the SAME ANSWER cites somewhere else: topically
//                    adjacent and definitely inside the turn's pooled
//                    evidence. NOTE it is not established that the claim is
//                    TRUE in that doc — only that the link now points at the
//                    wrong one of two documents the answer already used. This
//                    is still the class the shipped `refute` auditor cannot
//                    see: repointing a link leaves the answer prose
//                    byte-identical, and refute never resolves a UUID.
// Selection is index-derived, never Math.random, so the corpus is byte-stable
// across runs and the disk cache actually hits.
import fs from "node:fs";
import path from "node:path";
import { citationPairs, type CitationPair } from "../../src/server/chat/verify/cite-pairs.ts";
import type { Indexes } from "../../src/server/retrieval/indexes.ts";

export type NegKind = "random" | "parent" | "sibling" | "same_title" | "cited_elsewhere";
export type CaseKind = "positive" | NegKind;

export interface CiteCase {
  claim: string;
  uuid: string;
  kind: CaseKind;
  /** For a negative: the doc the sentence originally cited. */
  originalUuid?: string;
  source: string;
}

const CORPORA = ["scripts/eval/eval-corpora/evidence", "scripts/eval/eval-corpora/fable"];

interface Record_ { id?: string; question?: string; answer?: string }

export function loadRecords(): { file: string; rec: Record_ }[] {
  const out: { file: string; rec: Record_ }[] = [];
  for (const dir of CORPORA) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      try {
        out.push({ file: path.basename(f), rec: JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Record_ });
      } catch {
        /* a malformed fixture is skipped, not fatal */
      }
    }
  }
  return out;
}

/** Deterministic pick: same list + same seed ⇒ same element, forever. */
function pick<T>(arr: T[], seed: number): T | null {
  if (!arr.length) return null;
  let h = 2166136261;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return arr[Math.abs(h) % arr.length];
}

export function buildCases(ix: Indexes, kinds: Set<CaseKind>): CiteCase[] {
  const allUuids = [...ix.docMap.keys()].sort();
  // Title → every doc sharing it, for the same_title class.
  const byTitle = new Map<string, string[]>();
  for (const [uuid, d] of ix.docMap) {
    const k = d.title.trim().toLowerCase();
    const arr = byTitle.get(k);
    if (arr) arr.push(uuid);
    else byTitle.set(k, [uuid]);
  }
  for (const arr of byTitle.values()) arr.sort();

  const cases: CiteCase[] = [];
  let seed = 0;
  for (const { file, rec } of loadRecords()) {
    if (!rec.answer) continue;
    const pairs: CitationPair[] = citationPairs(rec.answer).filter((p) => ix.docMap.get(p.uuid));
    const inAnswer = [...new Set(pairs.map((p) => p.uuid))];
    for (const p of pairs) {
      seed++;
      const doc = ix.docMap.get(p.uuid)!;
      if (kinds.has("positive")) cases.push({ ...p, kind: "positive", source: file });

      const add = (kind: NegKind, uuid: string | null) => {
        if (!uuid || uuid === p.uuid || !kinds.has(kind)) return;
        cases.push({ claim: p.claim, uuid, kind, originalUuid: p.uuid, source: file });
      };
      add("random", pick(allUuids, seed));
      add("parent", doc.parentId ?? null);
      add("sibling", pick((ix.childrenIndex.get(doc.parentId ?? "") ?? []).map((c) => c.id).filter((id) => id !== p.uuid), seed));
      add("same_title", pick((byTitle.get(doc.title.trim().toLowerCase()) ?? []).filter((id) => id !== p.uuid), seed));
      add("cited_elsewhere", pick(inAnswer.filter((id) => id !== p.uuid), seed));
    }
  }
  return cases;
}
