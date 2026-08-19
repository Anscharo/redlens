import { describe, it, expect } from "vitest";
import { unwrapCodeCitations, parseDefinitions } from "./citations";

const U = "/atlas/11111111-1111-1111-1111-111111111111";

describe("unwrapCodeCitations", () => {
  it("moves the backticks inside the link text of a backticked inline citation", () => {
    // The shape measured in real answers: the model wraps the whole link
    // because the link text is an address / reward code.
    expect(unwrapCodeCitations(`The code is \`[128](${U})\`.`)).toBe(`The code is [\`128\`](${U}).`);
  });

  it("unwraps a backticked full reference citation", () => {
    expect(unwrapCodeCitations("`[0x6B17][pause-proxy]`")).toBe("[`0x6B17`][pause-proxy]");
  });

  it("unwraps a backticked bare citation only when its label is defined", () => {
    const defined = `[spark-rate]: ${U}\n\nThe rate is \`[spark-rate]\`.`;
    expect(unwrapCodeCitations(defined)).toContain("[`spark-rate`]");
    expect(unwrapCodeCitations("An array index like `[0]` is code.")).toBe(
      "An array index like `[0]` is code.",
    );
  });

  it("leaves a code span that is more than a citation alone", () => {
    const src = `\`foo [128](${U})\``;
    expect(unwrapCodeCitations(src)).toBe(src);
  });

  it("leaves fenced code blocks alone", () => {
    const src = `\`\`\`md\n\`[128](${U})\`\n\`\`\``;
    expect(unwrapCodeCitations(src)).toBe(src);
  });

  it("unwraps each of two code spans on one line without bridging them", () => {
    const src = `\`[128](${U})\` and \`[129](${U})\``;
    expect(unwrapCodeCitations(src)).toBe(`[\`128\`](${U}) and [\`129\`](${U})`);
  });

  it("leaves an already-correct citation untouched", () => {
    expect(unwrapCodeCitations(`[\`128\`](${U})`)).toBe(`[\`128\`](${U})`);
    expect(unwrapCodeCitations(`[128](${U})`)).toBe(`[128](${U})`);
  });

  it("leaves a multi-backtick code span alone", () => {
    const src = `\`\`[128](${U})\`\``;
    expect(unwrapCodeCitations(src)).toBe(src);
  });
});

describe("parseDefinitions", () => {
  it("normalizes labels and keeps the first definition of a repeated label", () => {
    const content = `[Spark  Rate]: ${U}\n[spark rate]: /atlas/22222222-2222-2222-2222-222222222222\n`;
    expect(parseDefinitions(content).get("spark rate")).toBe("11111111-1111-1111-1111-111111111111");
  });
});
