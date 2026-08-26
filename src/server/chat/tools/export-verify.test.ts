// Unit tests for the export artifact verifier. Uses the real in-memory indexes
// (pg-free). Run under `bun test`.
import { test, expect } from "bun:test";
import { loadIndexes } from "../../retrieval/indexes.ts";
import { checkExportArtifact } from "./export-verify.ts";
import type { ExportArtifact } from "./export-tool.ts";

const ix = loadIndexes();
const art = (over: Partial<ExportArtifact>): ExportArtifact => ({
  format: "markdown",
  filename: "x",
  mime: "",
  content: "",
  bytes: 0,
  ...over,
});

const ADDR = "0x00000000000000000000000000000000deadbeef"; // valid EVM shape, in no evidence

test("markdown: an ungrounded on-chain address is a hard failure", () => {
  const r = checkExportArtifact(art({ format: "markdown", content: `The contract is ${ADDR}.` }), [], ix);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.problems.join(" ")).toContain(ADDR);
});

test("csv: an ungrounded on-chain address is a hard failure too", () => {
  const r = checkExportArtifact(art({ format: "csv", content: `"Contract"\r\n"${ADDR}"` }), [], ix);
  expect(r.ok).toBe(false);
});

test("markdown: an ungrounded verbatim quote is a hard failure", () => {
  const quote = "> this is a long verbatim sentence that certainly appears in no evidence at all";
  const r = checkExportArtifact(art({ format: "markdown", content: quote }), [], ix);
  expect(r.ok).toBe(false);
});

test("csv: quote-grounding is skipped — a long unmatched cell still passes", () => {
  // The same text in a CSV cell must NOT trip quote-grounding: every RFC-4180
  // cell is wrapped in quotes, so treating them as verbatim-quote claims would
  // false-positive on ordinary data.
  const content = `"Note"\r\n"this is a long verbatim sentence that certainly appears in no evidence at all"`;
  const r = checkExportArtifact(art({ format: "csv", content }), [], ix);
  expect(r.ok).toBe(true);
});

test("markdown: a fabricated citation UUID is a hard failure", () => {
  const r = checkExportArtifact(
    art({ format: "markdown", content: "See [Doc](/atlas/00000000-0000-0000-0000-000000000000)." }),
    [],
    ix,
  );
  expect(r.ok).toBe(false);
});

test("clean prose with nothing to ground passes and returns its content", () => {
  const r = checkExportArtifact(art({ format: "markdown", content: "A plain summary." }), [], ix);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.content).toBe("A plain summary.");
});

test("an address that IS present in the evidence is grounded and passes", () => {
  const r = checkExportArtifact(art({ format: "markdown", content: `Contract ${ADDR}.` }), [`some tool result mentioning ${ADDR}`], ix);
  expect(r.ok).toBe(true);
});

// ── External (Monthly Settlement Cycle) evidence ──────────────────────────────
// A file outlives the conversation, so an export built on the MSC brief faces
// the same non-Atlas attribution rules the harness applies to the chat answer.
const MSC_BRIEF = JSON.stringify({
  source_class: "external",
  not_atlas: true,
  required_disclaimer: "These figures are not from the Sky Atlas. They come from Soter Labs workbooks.",
  three_way: { to_sky: 5000000 },
});
const DISCLAIMER = "These figures are not from the Sky Atlas — Soter Labs Monthly Settlement Cycle workbooks.";

test("markdown: exporting settlement figures without the non-Atlas disclaimer is withheld", () => {
  const r = checkExportArtifact(
    art({ format: "markdown", content: "Spark sent 5,000,000 USDS to Sky." }),
    { atlasTexts: [], externalTexts: [MSC_BRIEF] },
    ix,
  );
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.problems.join(" ")).toContain("non-Atlas attribution");
});

test("csv: the disclaimer requirement applies to CSV exports too, and a source cell satisfies it", () => {
  const bare = checkExportArtifact(
    art({ format: "csv", content: '"To Sky"\r\n"5,000,000"' }),
    { atlasTexts: [], externalTexts: [MSC_BRIEF] },
    ix,
  );
  expect(bare.ok).toBe(false);

  const sourced = checkExportArtifact(
    art({ format: "csv", content: `"To Sky","Source"\r\n"5,000,000","${DISCLAIMER}"` }),
    { atlasTexts: [], externalTexts: [MSC_BRIEF] },
    ix,
  );
  expect(sourced.ok).toBe(true);
});

test("markdown: a settlement dollar cited as /atlas/<uuid> is withheld", () => {
  const uuid = ix.docMap.keys().next().value as string;
  const r = checkExportArtifact(
    art({ format: "markdown", content: `${DISCLAIMER}\n\nSpark sent [5,000,000 USDS](/atlas/${uuid}) to Sky.` }),
    { atlasTexts: [], externalTexts: [MSC_BRIEF] },
    ix,
  );
  expect(r.ok).toBe(false);
  // The steer has to carry BOTH halves: which figure was misattributed and
  // where it really came from (from findMscCitedAsAtlas), then the remedy.
  if (!r.ok) {
    const problems = r.problems.join(" ");
    expect(problems).toContain("5,000,000");
    expect(problems).toContain("external settlement brief");
    expect(problems).toContain("Sky Forum permalink");
  }
});

test("markdown: coincidental digits in the cited atlas doc do not launder an MSC figure", () => {
  // Pick a real atlas figure, put the same digits in the MSC brief, cite it as
  // /atlas/<that doc>. findUngroundedCitationValues would skip this; the MSC
  // check must not.
  let uuid = "";
  let value = "";
  for (const [id, doc] of ix.docMap) {
    const v = (doc.content.match(/\b\d[\d,]*(?:\.\d+)?\b/g) ?? []).find((m) => Number(m.replace(/,/g, "")) > 20);
    if (v) {
      uuid = id;
      value = v;
      break;
    }
  }
  expect(uuid).toBeTruthy();
  const brief = JSON.stringify({
    source_class: "external",
    three_way: { to_sky: Number(value.replace(/,/g, "")) },
  });
  const r = checkExportArtifact(
    art({ format: "markdown", content: `${DISCLAIMER}\n\n[${value}](/atlas/${uuid})` }),
    { atlasTexts: [], externalTexts: [brief] },
    ix,
  );
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.problems.join(" ")).toContain(value);
});

test("a flat evidence list still means 'all atlas' — no disclaimer demanded", () => {
  const r = checkExportArtifact(art({ format: "markdown", content: "Spark sent 5,000,000 USDS to Sky." }), [MSC_BRIEF], ix);
  expect(r.ok).toBe(true);
});
