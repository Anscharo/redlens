// Citation repair tests — real disk indexes, like the other check tests, so
// repairs resolve against actual docs.
import { test, expect } from "bun:test";
import { loadIndexes } from "./indexes.ts";
import { normalizeForMatch } from "./verify-checks.ts";
import { repairCitations } from "./citation-repair.ts";

const ix = loadIndexes();
const realUuid = ix.docMap.keys().next().value as string;
const realDoc = ix.docMap.get(realUuid)!;
const FAKE_UUID = "12345678-1234-4321-8765-1234567890ab";

// A doc whose normalized title appears exactly once in the whole atlas — the
// target for the whole-atlas title-match fallback.
function uniqueTitleDoc() {
  const counts = new Map<string, number>();
  for (const d of ix.docMap.values()) {
    const k = normalizeForMatch(d.title);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const d of ix.docMap.values()) {
    if (d.title.length > 12 && counts.get(normalizeForMatch(d.title)) === 1) return d;
  }
  throw new Error("no unique-title doc in the atlas");
}

test("valid links pass through untouched", () => {
  const answer = `See [${realDoc.title}](/atlas/${realUuid}) and [ext](https://example.com).`;
  const r = repairCitations(answer, [], ix);
  expect(r.content).toBe(answer);
  expect(r.repaired).toEqual([]);
  expect(r.stripped).toEqual([]);
});

test("garbled uuid is repaired to the near-miss evidence doc", () => {
  // Flip three hex chars of a uuid that appeared in this turn's tool results.
  const flip = (c: string) => (c === "0" ? "1" : "0");
  const garbled = realUuid.slice(0, -3) + [...realUuid.slice(-3)].map(flip).join("");
  expect(garbled).not.toBe(realUuid);
  const r = repairCitations(`Per [Doc](/atlas/${garbled}).`, [`{"id":"${realUuid}"}`], ix);
  expect(r.content).toBe(`Per [Doc](/atlas/${realUuid}).`);
  expect(r.repaired).toEqual([{ title: "Doc", from: garbled, to: realUuid }]);
});

test("a garbled uuid with no evidence pool is stripped, not guessed", () => {
  const flip = (c: string) => (c === "0" ? "1" : "0");
  const garbled = realUuid.slice(0, -3) + [...realUuid.slice(-3)].map(flip).join("");
  const r = repairCitations(`Per [Doc](/atlas/${garbled}).`, [], ix);
  expect(r.content).toBe("Per Doc.");
  expect(r.stripped).toEqual([{ title: "Doc", target: garbled }]);
});

test("doc_no href resolves through byDocNo", () => {
  const target = ix.byDocNo.get(realDoc.doc_no)!;
  const r = repairCitations(`See [X](/atlas/${realDoc.doc_no}).`, [], ix);
  expect(r.content).toBe(`See [X](/atlas/${target.id}).`);
});

test("truncated uuid with a unique prefix is repaired", () => {
  const prefix = realUuid.slice(0, 18); // 16 hex chars — unique in practice
  const r = repairCitations(`See [Doc](/atlas/${prefix}).`, [], ix);
  expect(r.content).toBe(`See [Doc](/atlas/${realUuid}).`);
});

test("fabricated uuid repaired by title match against retrieved docs", () => {
  // The linked title matches a doc that was actually in the tool results —
  // trusted even when the title is not globally unique.
  const evidence = [`{"id":"${realUuid}","title":${JSON.stringify(realDoc.title)}}`];
  const r = repairCitations(`Per [${realDoc.title}](/atlas/${FAKE_UUID}).`, evidence, ix);
  expect(r.content).toBe(`Per [${realDoc.title}](/atlas/${realUuid}).`);
});

test("fabricated uuid repaired by unique whole-atlas title match; doc_no lead in the text is ignored", () => {
  const doc = uniqueTitleDoc();
  const r = repairCitations(`Per [Z.9.9 - ${doc.title}](/atlas/${FAKE_UUID}).`, [], ix);
  expect(r.content).toBe(`Per [Z.9.9 - ${doc.title}](/atlas/${doc.id}).`);
});

test("unrepairable links are de-linkified and reported", () => {
  const answer = `See [Entirely Invented Governance Doctrine](/atlas/${FAKE_UUID}) and [junk](/atlas/not-a-thing).`;
  const r = repairCitations(answer, [], ix);
  expect(r.content).toBe("See Entirely Invented Governance Doctrine and junk.");
  expect(r.stripped.map((s) => s.target)).toEqual([FAKE_UUID, "not-a-thing"]);
});

test("fabricated uuid repaired via a real doc_no leading the link text", () => {
  // The exact live failure: real doc_no + made-up title suffix + invented uuid.
  const dotted = [...ix.docMap.values()].find((d) => /^[A-Z]{1,3}(\.\d+)+$/.test(d.doc_no))!;
  const canonical = ix.byDocNo.get(dotted.doc_no)!;
  const r = repairCitations(`See [${dotted.doc_no} - Anything At All](/atlas/${FAKE_UUID}).`, [], ix);
  expect(r.content).toBe(`See [${dotted.doc_no} - Anything At All](/atlas/${canonical.id}).`);
});

test("pseudo-citation (tool-name href) is promoted to a real citation via title, else de-linkified", () => {
  const doc = uniqueTitleDoc();
  const promoted = repairCitations(`See [${doc.title}](atlas_describe).`, [], ix);
  expect(promoted.content).toBe(`See [${doc.title}](/atlas/${doc.id}).`);
  const dropped = repairCitations("See [Document Structure](atlas_describe).", [], ix);
  expect(dropped.content).toBe("See Document Structure.");
  expect(dropped.stripped).toEqual([{ title: "Document Structure", target: "atlas_describe" }]);
});

test("real URLs, routes, and anchors are never touched by the pseudo-citation pass", () => {
  const answer = "See [ext](https://x.com), [mail](mailto:a@b.c), [report](/reports/processes), [anchor](#top).";
  const r = repairCitations(answer, [], ix);
  expect(r.content).toBe(answer);
  expect(r.stripped).toEqual([]);
});

test("the same bad uuid cited twice is repaired consistently", () => {
  const evidence = [`{"id":"${realUuid}","title":${JSON.stringify(realDoc.title)}}`];
  const answer = `A [${realDoc.title}](/atlas/${FAKE_UUID}) then B [${realDoc.title}](/atlas/${FAKE_UUID}).`;
  const r = repairCitations(answer, evidence, ix);
  expect(r.content).toBe(`A [${realDoc.title}](/atlas/${realUuid}) then B [${realDoc.title}](/atlas/${realUuid}).`);
  expect(r.repaired).toHaveLength(2);
});
