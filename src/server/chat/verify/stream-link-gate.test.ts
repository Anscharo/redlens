// Gate tests: the parser against a fake render (split at every chunk boundary
// so no token alignment is assumed), the event pipe, and — the money test —
// byte parity with repairCitations against real disk indexes.
import { test, expect } from "bun:test";
import { loadIndexes } from "../../retrieval/indexes.ts";
import { createLinkJudge, repairCitations } from "./citation-repair.ts";
import { createLinkGate, gatedChat, type LinkGate } from "./stream-link-gate.ts";
import type { ChatEvent } from "../chat-loop.ts";

const ix = loadIndexes();
const realUuid = ix.docMap.keys().next().value as string;
const realDoc = ix.docMap.get(realUuid)!;
const FAKE_UUID = "12345678-1234-4321-8765-1234567890ab";

// Uppercases the target of every link — visibly marks that render ran.
const markingRender = (title: string, target: string) => `[${title}](${target.toUpperCase()})`;
const keepRender = (_t: string, _g: string, raw: string) => raw;

// Feed `text` in chunks of `size`; return everything emitted incl. the flush.
function run(gate: LinkGate, text: string, size: number): string {
  let out = "";
  for (let i = 0; i < text.length; i += size) out += gate.push(text.slice(i, i + size));
  return out + gate.flush();
}

// Every chunk size from char-by-char up — boundary placement must never matter.
function atEverySplit(text: string, render: Parameters<typeof createLinkGate>[0]): string[] {
  return [...new Set([1, 2, 3, 5, 7, text.length].map((n) => run(createLinkGate(render), text, n)))];
}

test("plain text and complete links pass through byte-identical at any chunking", () => {
  const text = "See [ext](https://x.com) and (parens) plus [a] alone, then [b][c](/y).";
  expect(atEverySplit(text, keepRender)).toEqual([text]);
});

test("render rewrites a link regardless of where chunk boundaries fall", () => {
  const outs = atEverySplit("Per [Doc](/atlas/abc) ok.", markingRender);
  expect(outs).toEqual(["Per [Doc](/ATLAS/ABC) ok."]);
});

test("de-linkify: render returning just the title strips the link", () => {
  const gate = createLinkGate((title) => title);
  expect(run(gate, "See [Invented Doc](/atlas/bad-uuid).", 3)).toBe("See Invented Doc.");
});

test("non-links flush raw: ] without (, whitespace in href, empty parts", () => {
  for (const text of ["a [b] c", "a [b] (c)", "[a](x y)", "[](x)", "[a]()", "[ ] ["]) {
    expect(atEverySplit(text, markingRender)).toEqual([text]);
  }
});

test("a [ closing into a new link is re-entered: [a][b](x)", () => {
  expect(atEverySplit("[a][b](x)", markingRender)).toEqual(["[a][b](X)"]);
});

test("an unclosed hold past the cap flushes raw instead of stalling", () => {
  const text = "[" + "x".repeat(500);
  const gate = createLinkGate(markingRender);
  const out = run(gate, text, 7);
  expect(out).toBe(text);
});

test("flush returns a mid-link tail raw", () => {
  const gate = createLinkGate(markingRender);
  expect(gate.push("end [cut](/atl")).toBe("end ");
  expect(gate.flush()).toBe("[cut](/atl");
});

test("gate output matches repairCitations byte-for-byte on real repairs", () => {
  const flip = (c: string) => (c === "0" ? "1" : "0");
  const garbled = realUuid.slice(0, -3) + [...realUuid.slice(-3)].map(flip).join("");
  const evidence = [`{"id":"${realUuid}","title":${JSON.stringify(realDoc.title)}}`];
  const answers = [
    `Valid [${realDoc.title}](/atlas/${realUuid}) stays.`,
    `Garbled [Doc](/atlas/${garbled}) repairs.`,
    `Fabricated [${realDoc.title}](/atlas/${FAKE_UUID}) repairs by title.`,
    `Unrepairable [Entirely Invented Doctrine](/atlas/${FAKE_UUID}) strips.`,
    "Pseudo [Document Structure](atlas_describe) strips; [ext](https://x.com), [r](/reports/x), [#a](#top) stay.",
    `Doc_no href [X](/atlas/${realDoc.doc_no}) repairs.\n\nAnd a bare [note] survives.`,
  ];
  const judge = createLinkJudge(evidence, ix);
  const render = (title: string, target: string, raw: string): string => {
    const v = judge(title, target);
    if (v.action === "repair") return `[${title}](/atlas/${v.to})`;
    if (v.action === "strip") return title;
    return raw;
  };
  for (const answer of answers) {
    const expected = repairCitations(answer, evidence, ix).content;
    expect(atEverySplit(answer, render)).toEqual([expected]);
  }
});

async function* emit(events: ChatEvent[]): AsyncIterable<ChatEvent> {
  for (const ev of events) yield ev;
}
const token = (text: string): ChatEvent => ({ type: "token", text });
const DONE: ChatEvent = { type: "done", content: "", usage: { input: 0, output: 0 }, generationId: null, toolCalls: [], lengthCapped: false, transcript: [] };

test("gatedChat: gates tokens, resets on clear, flushes the tail before done", async () => {
  const events: ChatEvent[] = [
    token("pre [half](/atl"), // held tail dropped with the clear, like the client's buffer
    { type: "clear" },
    token("See [Doc](/atla"),
    token("s/abc) end [cut](/x"),
    DONE,
  ];
  const out: ChatEvent[] = [];
  for await (const ev of gatedChat(emit(events), () => createLinkGate(markingRender))) out.push(ev);
  expect(out.map((e) => e.type)).toEqual(["token", "clear", "token", "token", "token", "done"]);
  const texts = out.filter((e) => e.type === "token").map((e) => (e as { text: string }).text);
  expect(texts[0]).toBe("pre ");
  expect(texts.slice(1).join("")).toBe("See [Doc](/ATLAS/ABC) end [cut](/x");
});
