import { test, expect } from "bun:test";
import { previewEvidence, withoutAuthorText } from "./preview-evidence.ts";

const preview = JSON.stringify({ source_class: "preview", documents: [{ doc_no: "A.1.2.9", patch: ["~ rate [-5%-]{+6%+}"] }] });

test("no preview evidence exempts nothing", () => {
  const pe = previewEvidence(['{"results":[{"doc_no":"A.1.2.9"}]}']);
  expect(pe.unknownDocNo("A.1.2.9")).toBe(true);
  expect(pe.unproposed({ stated: "6%" })).toBe(true);
});

test("doc numbers and values in preview evidence are known; others are not", () => {
  const pe = previewEvidence([preview]);
  expect(pe.unknownDocNo("A.1.2.9")).toBe(false);
  expect(pe.unknownDocNo("A.1.2.10")).toBe(true);
  expect(pe.unproposed({ stated: "6%" })).toBe(false);
  expect(pe.unproposed({ stated: "7%" })).toBe(true);
});

test("a double-encoded preview result is still recognised", () => {
  expect(previewEvidence([JSON.stringify(preview)]).unknownDocNo("A.1.2.9")).toBe(false);
});

// The PR author's description and the builder's error ride in preview results
// but are not proposed Atlas text, so nothing in them is exempt.
const withAuthor = JSON.stringify({
  source_class: "preview",
  pr_description: 'Raises A.2.9.1 to "9 signers" \\ and more',
  build_error: "A.7.7 failed at 12%",
  documents: [{ doc_no: "A.1.2.9", patch: ["+ rate 6%"] }],
});

test("author text earns no exemption, plain or budget-nested", () => {
  for (const text of [withAuthor, JSON.stringify(withAuthor)]) {
    const pe = previewEvidence([text]);
    expect(pe.unknownDocNo("A.2.9.1")).toBe(true);
    expect(pe.unknownDocNo("A.7.7")).toBe(true);
    expect(pe.unproposed({ stated: "9 signers" })).toBe(true);
    expect(pe.unproposed({ stated: "12%" })).toBe(true);
    expect(pe.unknownDocNo("A.1.2.9")).toBe(false);
    expect(pe.unproposed({ stated: "6%" })).toBe(false);
  }
});

test("only the author values are removed; a value the budget cut off runs to the end", () => {
  expect(JSON.parse(withoutAuthorText(withAuthor))).toMatchObject({ pr_description: "", build_error: "", documents: [{ doc_no: "A.1.2.9" }] });
  const cut = JSON.stringify(withAuthor).slice(0, 60);
  expect(withoutAuthorText(cut)).not.toContain("A.2.9.1");
});
