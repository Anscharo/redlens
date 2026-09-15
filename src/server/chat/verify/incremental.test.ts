// Incremental (per-paragraph) verification tests. Uses the real disk indexes,
// same pattern as verify-checks.test.ts.
import { test, expect } from "bun:test";
import { loadIndexes } from "../../retrieval/indexes.ts";
import { describeFindings, checkParagraph, createParagraphStream, type ParagraphEvidence } from "./incremental.ts";
import { createParagraphSegmenter } from "./paragraphs.ts";

const ix = loadIndexes();
const FAKE_UUID = "00000000-dead-beef-0000-000000000000";
const emptyEvidence: ParagraphEvidence = { atlasTexts: [], externalTexts: [], allTexts: [] };
const stream = () => createParagraphStream({ ix, question: "hi", evidence: () => emptyEvidence });

test("describeFindings wording matches VerifyFindings.tsx's reader-facing sentences", () => {
  // The uuid/doc_no/mismatch "does not exist" findings can only ever be
  // observed this way: checkParagraph's own repairCitations pass (like the
  // whole-answer pass) always resolves an /atlas/<uuid> link to either a real
  // doc (keep/repair) or strips it outright — there is no path back to a
  // "kept but invalid" citation surviving repair. describeFindings is the
  // pure formatter, tested directly against the wording it must produce.
  const findings = describeFindings({
    invalidCitations: [FAKE_UUID],
    invalidDocNos: ["Q.99.42.7"],
    docNoMismatches: ["A.1.6 links to A.2.7 (Other Title)"],
    ungroundedQuotes: ["an invented atlas passage nobody wrote"],
    ungroundedAddresses: ["0x0000000000000000000000000000000000dead"],
    ungroundedCitationValues: ["5% cited to A.1.1 (Title) but absent from it"],
    paramMismatches: [
      { stated: "50", actual: "60", name: "maxamount", title: "Some Cap", owner: "Keel", uuid: FAKE_UUID, doc_no: "A.1.2" },
    ],
    mscCitedAsAtlas: ["1,000,000 USDS cited as /atlas/x (A.1.1) but comes from the external settlement brief"],
  });
  expect(findings).toEqual([
    `cites a document that does not exist: ${FAKE_UUID}`,
    "document number does not exist in the atlas: Q.99.42.7",
    "document number doesn’t match its link: A.1.6 links to A.2.7 (Other Title)",
    "quote not found in any retrieved source: “an invented atlas passage nobody wrote”",
    "address not found in any retrieved source: 0x0000000000000000000000000000000000dead",
    "5% cited to A.1.1 (Title) but absent from it",
    "answer states 50 for maxamount (Keel) but the atlas value is 60 — A.1.2",
    "1,000,000 USDS cited as /atlas/x (A.1.1) but comes from the external settlement brief",
  ]);
});

test("segmentation: two paragraphs in one push yield two checks", () => {
  const s = stream();
  const text = "First paragraph text here.\n\nSecond paragraph text here.\n\n";
  const checks = s.push(text);
  expect(checks).toHaveLength(2);
  expect(checks[0]).toMatchObject({ index: 0, text: "First paragraph text here.", findings: [] });
  expect(checks[1]).toMatchObject({ index: 1, text: "Second paragraph text here.", findings: [] });
});

test("segmentation: a blank line inside a fenced code block never splits the paragraph", () => {
  // ~~~ fences (not ```) sidestep backtick-escaping noise in this literal —
  // the segmenter treats both fence styles identically.
  const s = stream();
  const text = [
    "Intro paragraph.",
    "",
    "~~~",
    "code line one",
    "",
    "code line two",
    "~~~",
    "",
    "Trailing paragraph.",
    "",
    "",
  ].join("\n");
  const checks = s.push(text);
  expect(checks).toHaveLength(3);
  expect(checks[0].text).toBe("Intro paragraph.");
  expect(checks[1].text).toContain("code line one");
  expect(checks[1].text).toContain("code line two");
  expect(checks[2].text).toBe("Trailing paragraph.");
});

test("reference-style definition lines are collected, never emitted as a paragraph, and expand a later use", () => {
  const uuid = ix.docMap.keys().next().value as string;
  const s = stream();
  const text = [`[the-doc]: /atlas/${uuid}`, "", "See [it][the-doc] for details.", "", ""].join("\n");
  const checks = s.push(text);
  expect(checks).toHaveLength(1);
  expect(checks[0].text).toBe(`See [it](/atlas/${uuid}) for details.`);
  expect(checks[0].findings).toEqual([]);
});

test("a fabricated doc number in plain prose survives repair (it's not a link) and is flagged", () => {
  // repairCitations only rewrites markdown links, so a bare doc_no mention in
  // prose is untouched — this is the one finding class that genuinely
  // survives the paragraph pipeline end to end.
  const check = checkParagraph("That rule is defined in Q.99.42.7 of the atlas.", "", {
    ix, question: "hi", evidence: emptyEvidence,
  });
  expect(check.findings).toEqual(["document number does not exist in the atlas: Q.99.42.7"]);
});

test("a clean paragraph yields no findings", () => {
  const check = checkParagraph("This is an ordinary sentence with no citations, quotes, or figures.", "", {
    ix, question: "hi", evidence: emptyEvidence,
  });
  expect(check.findings).toEqual([]);
});

test("reset restarts the paragraph index at 0", () => {
  const s = stream();
  const first = s.push("Paragraph one.\n\n");
  expect(first[0].index).toBe(0);
  const second = s.push("Paragraph two.\n\n");
  expect(second[0].index).toBe(1);
  s.reset();
  const third = s.push("Paragraph three.\n\n");
  expect(third[0].index).toBe(0);
});

test("flush returns the trailing unterminated paragraph exactly once", () => {
  const s = stream();
  expect(s.push("Trailing text with no blank line yet.")).toEqual([]);
  const tail = s.flush();
  expect(tail).not.toBeNull();
  expect(tail?.text).toBe("Trailing text with no blank line yet.");
  expect(s.flush()).toBeNull();
});

// ── Segmenter unit tests (paragraphs.ts) ────────────────────────────────────
test("segmenter: definitions() accumulates only recognised reference-definition lines", () => {
  const seg = createParagraphSegmenter();
  seg.push("[a]: /atlas/11111111-1111-1111-1111-111111111111\n[b]: /atlas/22222222-2222-2222-2222-222222222222\n\nprose\n\n");
  expect(seg.definitions()).toBe(
    "[a]: /atlas/11111111-1111-1111-1111-111111111111\n[b]: /atlas/22222222-2222-2222-2222-222222222222",
  );
});
