import { describe, expect, it } from "vitest";
import { measureSource } from "../scripts/lib/size-metrics.mjs";
import { inSizeScope, ratchet } from "../scripts/lib/size-ratchet.mjs";

const body = (n: number) => Array.from({ length: n }, (_, i) => `  call${i}();`).join("\n");
const fn = (name: string, n: number) => `function ${name}() {\n${body(n)}\n}\n`;
const measure = (files: Record<string, string>) =>
  new Map(Object.entries(files).map(([path, src]) => [path, measureSource(path, src)]));

describe("measureSource", () => {
  it("counts code lines only: blanks and comments are free", () => {
    const src = "// header\n\nconst a = 1; // trailing\n/*\n block\n*/\nconst b = 2;\n";
    expect(measureSource("a.ts", src).lines).toBe(2);
  });

  it("names functions by binding, nests scopes, and suffixes repeats", () => {
    const src = `const outer = () => { function inner() {} };\nclass K { m() {} }\nconst x = memo(() => 1);\nconst y = list.map(() => 2);\nfunction dup() {}\nfunction dup() {}\n`;
    expect(measureSource("a.tsx", src).fns.map((f) => f.name)).toEqual(["outer", "outer.inner", "K.m", "x", "list.map", "dup", "dup#2"]);
  });

  it("marks PascalCase functions in .tsx as components", () => {
    const { fns } = measureSource("a.tsx", "function Card() { return <div />; }\nfunction helper() {}\n");
    expect(fns.map((f) => f.component)).toEqual([true, false]);
  });

  it("counts lines correctly after astral-plane characters", () => {
    const { fns } = measureSource("a.ts", `const s = "😀😀😀";\n${fn("f", 3)}`);
    expect(fns[0]).toMatchObject({ name: "f", line: 2, lines: 5 });
  });
});

describe("ratchet", () => {
  it("fails a new function over the limit and a grandfathered one that grew", () => {
    const m = measure({ "a.ts": fn("big", 60) + fn("old", 70) });
    const { findings } = ratchet(m, { "a.ts::old": 65 });
    expect(findings.filter((f) => f.level === "error").map((f) => [f.key, f.reason])).toEqual([
      ["a.ts::big", "new"],
      ["a.ts::old", "grew"],
    ]);
  });

  it("gives components 1.5x the function limit", () => {
    const { findings } = ratchet(measure({ "a.tsx": `function Card() {\n${body(70)}\n  return null;\n}\n` }), {});
    expect(findings.map((f) => f.level)).toEqual(["warn"]);
  });

  it("flags a baseline that is looser than the code, and tightens it", () => {
    const m = measure({ "a.ts": fn("old", 55) + fn("fixed", 3) });
    const { findings, tightened } = ratchet(m, { "a.ts::old": 80, "a.ts::fixed": 60, "gone.ts": 300 });
    expect(findings.filter((f) => f.level === "stale").map((f) => f.reason)).toEqual(["shrank", "fixed", "gone"]);
    expect(tightened).toEqual({ "a.ts::old": 57 });
  });

  it("scopes advisory warnings to changed files", () => {
    const m = measure({ "a.ts": fn("f", 30), "b.ts": fn("g", 30) });
    const { findings } = ratchet(m, {}, new Set(["b.ts"]));
    expect(findings.map((f) => f.key)).toEqual(["b.ts::g"]);
  });
});

describe("inSizeScope", () => {
  it("measures first-party source, not tests or declarations", () => {
    expect(["src/a.ts", "apps/web/src/B.tsx", "scripts/lib/c.mjs"].every(inSizeScope)).toBe(true);
    expect(["src/a.test.ts", "scripts/lib/c.d.mts", "vendor/x.ts", "scripts_tests/x.ts"].some(inSizeScope)).toBe(false);
  });
});
