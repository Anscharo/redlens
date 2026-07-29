// createCitationGate: buffers a leading reference-style definition block,
// repairs the whole citation table once, releases it, then streams prose
// through the ordinary inline gate. Verified against real disk indexes so the
// repair judge resolves against actual docs, and at every chunk boundary so no
// token alignment is assumed.
import { test, expect } from "bun:test";
import { loadIndexes } from "../../retrieval/indexes.ts";
import { createLinkJudge, repairDefinitionBlock, repairCitations } from "./citation-repair.ts";
import { createCitationGate } from "./definition-block-gate.ts";
import type { LinkGate } from "./stream-link-gate.ts";

const ix = loadIndexes();
const realUuid = ix.docMap.keys().next().value as string;
const realDoc = ix.docMap.get(realUuid)!;

// The orchestrator's wiring, minus the try/catch: one judge drives both the
// inline render and the definition-block repair.
function makeGate(evidence: string[]): LinkGate {
  const judge = createLinkJudge(evidence, ix);
  const render = (title: string, target: string, raw: string): string => {
    const v = judge(title, target);
    if (v.action === "repair") return `[${title}](/atlas/${v.to})`;
    if (v.action === "strip") return title;
    return raw;
  };
  const repairBlock = (block: string): string => repairDefinitionBlock(block, judge).content;
  return createCitationGate({ render, repairBlock });
}

function run(gate: LinkGate, text: string, size: number): string {
  let out = "";
  for (let i = 0; i < text.length; i += size) out += gate.push(text.slice(i, i + size));
  return out + gate.flush();
}
function atEverySplit(text: string, evidence: string[]): string[] {
  return [...new Set([1, 2, 3, 5, 7, 13, text.length].map((n) => run(makeGate(evidence), text, n)))];
}

const garble = (uuid: string): string => uuid.slice(0, -3) + [...uuid.slice(-3)].map((c) => (c === "0" ? "1" : "0")).join("");

test("inline-only and plain answers pass through byte-identical at any chunking", () => {
  const text = `Lead sentence. See [${realDoc.title}](/atlas/${realUuid}) and [ext](https://x.com).\n\nMore prose.`;
  expect(atEverySplit(text, [])).toEqual([text]);
});

test("a leading definition block is buffered, repaired, and released before the answer completes", () => {
  const garbled = garble(realUuid);
  const evidence = [`{"id":"${realUuid}"}`];
  const gate = makeGate(evidence);
  // Stream the definition line, then the blank-line terminator, then prose.
  let out = gate.push(`[doc-a]: /atlas/${garbled}\n`);
  expect(out).toBe(""); // block held until it is known to be complete
  out += gate.push("\n"); // terminator → the repaired table is released now
  out += gate.push("The rate is [5%][doc-a] as of today.");
  // Repaired UUID is already emitted, before flush/done — the whole point.
  expect(out).toContain(`[doc-a]: /atlas/${realUuid}`);
  expect(out).not.toContain(garbled);
  out += gate.flush();
  expect(out).toBe(`[doc-a]: /atlas/${realUuid}\n\nThe rate is [5%][doc-a] as of today.`);
});

test("definition-block repair and prose passthrough are chunk-boundary independent", () => {
  const garbled = garble(realUuid);
  const answer = `[doc-a]: /atlas/${garbled}\n\nThe rate is [5%][doc-a] and holds [steady][doc-a].`;
  const expected = `[doc-a]: /atlas/${realUuid}\n\nThe rate is [5%][doc-a] and holds [steady][doc-a].`;
  expect(atEverySplit(answer, [`{"id":"${realUuid}"}`])).toEqual([expected]);
});

test("an unrepairable definition is dropped, never streamed as a live dead link", () => {
  const FAKE = "00000000-dead-beef-0000-000000000000";
  const answer = `[bad]: /atlas/${FAKE}\n\nText [here][bad] follows.`;
  // No evidence pool and a non-resolvable label → the definition is dropped;
  // the prose usage streams as literal brackets (remark then renders plain text).
  const outs = atEverySplit(answer, []);
  expect(outs).toHaveLength(1);
  expect(outs[0]).not.toContain(FAKE);
  expect(outs[0]).toContain("Text [here][bad] follows.");
});

test("a bottom definition block (prose first) is not buffered; its def lines pass through the inline gate untouched", () => {
  const answer = `The rate is [5%][doc-a] today.\n\n[doc-a]: /atlas/${realUuid}`;
  // Prose-first → gate goes straight to inline mode; the trailing `[label]: …`
  // line must survive verbatim (the accepted bottom-block degradation).
  const outs = atEverySplit(answer, [`{"id":"${realUuid}"}`]);
  expect(outs).toEqual([answer]);
});

test("gate output matches repairDefinitionBlock + repairCitations on the same answer", () => {
  const garbled = garble(realUuid);
  const evidence = [`{"id":"${realUuid}","title":${JSON.stringify(realDoc.title)}}`];
  const block = `[doc-a]: /atlas/${garbled}`;
  const prose = `\n\nInline [${realDoc.title}](/atlas/${garbled}) beside a [ref][doc-a].`;
  const expectedBlock = repairDefinitionBlock(block, createLinkJudge(evidence, ix)).content;
  const expectedProse = repairCitations(prose, evidence, ix).content;
  expect(atEverySplit(block + prose, evidence)).toEqual([expectedBlock + expectedProse]);
});
