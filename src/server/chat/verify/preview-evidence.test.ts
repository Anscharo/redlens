import { test, expect } from "bun:test";
import { previewEvidence } from "./preview-evidence.ts";

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
