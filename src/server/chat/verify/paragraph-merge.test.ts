// paragraph-merge.ts: the default (CHAT_REFUTE_MODE=paragraph) refute
// backbone. `parsed` is all-or-nothing so computeOverall can treat a
// timed-out/empty burst as unverified rather than a green pass.
import { test, expect } from "bun:test";
import { mergeParagraphRefutes } from "./paragraph-merge.ts";
import type { ParagraphRefute } from "./paragraph-refute.ts";

function para(p: Partial<ParagraphRefute> & { index: number }): ParagraphRefute {
  return {
    text: `p${p.index}`,
    contradictions: [],
    notFound: [],
    discarded: 0,
    parsed: true,
    latencyMs: 1,
    usage: { input: 1, output: 1 },
    timedOut: false,
    ...p,
  };
}

test("empty array → parsed:false (no backbone the audit actually checked)", () => {
  const b = mergeParagraphRefutes([]);
  expect(b.parsed).toBe(false);
  expect(b.candidates).toEqual([]);
  expect(b.paragraphs).toEqual({ count: 0, parsed: 0, candidates: 0, discarded: 0, timedOut: 0 });
});

test("one timed-out paragraph among otherwise clean ones → parsed:false", () => {
  const b = mergeParagraphRefutes([
    para({ index: 0 }),
    para({ index: 1, parsed: false, timedOut: true, usage: null, latencyMs: null }),
  ]);
  expect(b.parsed).toBe(false);
  expect(b.candidates).toEqual([]);
  expect(b.paragraphs).toEqual({ count: 2, parsed: 1, candidates: 0, discarded: 0, timedOut: 1 });
});

test("every submitted paragraph parsed, no candidates → parsed:true", () => {
  const b = mergeParagraphRefutes([para({ index: 0 }), para({ index: 1 })]);
  expect(b.parsed).toBe(true);
  expect(b.paragraphs).toEqual({ count: 2, parsed: 2, candidates: 0, discarded: 0, timedOut: 0 });
});
