import { describe, expect, it } from "bun:test";
import { candidateText, qwenPrompt, sortByScore, yesProbability } from "./eval-rerankers.ts";
import type { AtlasNode } from "../../src/types.ts";

const node = (id: string, doc_no: string, title: string, parentId: string | null, content = ""): AtlasNode =>
  ({ id, doc_no, title, parentId, content, type: "Core", depth: 1, order: 0, addressRefs: [] }) as unknown as AtlasNode;

describe("yesProbability", () => {
  it("sums casing variants on each side", () => {
    // Observed from the GGUF: "No" -1.02 and "no" -1.60 both carry mass.
    const p = yesProbability([
      { token: "No", logprob: Math.log(0.4) },
      { token: "no", logprob: Math.log(0.2) },
      { token: "yes", logprob: Math.log(0.3) },
      { token: "I", logprob: Math.log(0.1) },
    ]);
    expect(p).toBeCloseTo(0.3 / 0.9, 6);
  });
  it("is 0 when neither side appears", () => {
    expect(yesProbability([{ token: "I", logprob: -1 }])).toBe(0);
  });
});

describe("sortByScore", () => {
  it("is stable: ties keep retrieval order", () => {
    expect(sortByScore(["a", "b", "c", "d"], [0.5, 0.9, 0.5, 0.1])).toEqual(["b", "a", "c", "d"]);
  });
});

describe("candidateText", () => {
  it("prefixes up to four ancestor titles and caps the body", () => {
    const docMap = new Map<string, AtlasNode>();
    for (const [id, no, title, parent] of [
      ["r", "A", "Root", null], ["s", "A.6", "Scope", "r"], ["p", "A.6.1", "Product", "s"],
      ["h", "A.6.1.1", "Hub", "p"], ["c", "A.6.1.1.1", "Config", "h"],
    ] as const) docMap.set(id, node(id, no, title, parent));
    docMap.set("leaf", node("leaf", "A.6.1.1.1.1", "Rate", "c", "x ".repeat(2000)));
    const t = candidateText("leaf", docMap);
    expect(t.path).toBe("Scope › Product › Hub › Config");
    expect(t.title).toBe("A.6.1.1.1.1 Rate");
    expect(t.body.length).toBeLessThanOrEqual(1200);
    // The prompt carries the model card's yes/no system line and empty think block.
    const prompt = qwenPrompt("q", t);
    expect(prompt).toContain('can only be "yes" or "no"');
    expect(prompt.endsWith("<think>\n\n</think>\n\n")).toBe(true);
  });
});
