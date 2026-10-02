import { describe, expect, it, test } from "bun:test";
import { countTeachingWords, parseTeachCommand, TEACH_HELP, TEACH_LENGTH_RULE, TEACH_MAX_WORDS } from "./parse.ts";

describe("parseTeachCommand", () => {
  it("returns null when the message is not a /teach command", () => {
    expect(parseTeachCommand("what is a facilitator?")).toBeNull();
    expect(parseTeachCommand("please /teach me about Spark")).toBeNull();
    expect(parseTeachCommand("/teachme foo")).toBeNull();
    expect(parseTeachCommand("")).toBeNull();
  });

  it("parses /teach at the start, case-insensitive, with optional whitespace", () => {
    expect(parseTeachCommand("/teach Spark freeze lives under Spark")).toEqual({
      text: "Spark freeze lives under Spark",
    });
    expect(parseTeachCommand("  /TEACH   the foo bar")).toEqual({ text: "the foo bar" });
    expect(parseTeachCommand("/Teach\nline two")).toEqual({ text: "line two" });
  });

  it("treats a bare /teach as an empty teaching (help path)", () => {
    expect(parseTeachCommand("/teach")).toEqual({ text: "" });
    expect(parseTeachCommand("  /teach   ")).toEqual({ text: "" });
  });

  // The handler rejects over the word cap with the count; the parser must not
  // silently trim the body first, or the user never learns why.
  it("passes an oversized body through whole", () => {
    const body = "word ".repeat(TEACH_MAX_WORDS * 3).trim();
    expect(parseTeachCommand(`/teach ${body}`)!.text).toBe(body);
  });
});

describe("countTeachingWords", () => {
  it("counts word-like tokens only", () => {
    expect(countTeachingWords("When I say MSC I mean monthly settlement reports.")).toBe(9);
    expect(countTeachingWords("  — … --  ")).toBe(0);
    expect(countTeachingWords("a\nb\tc")).toBe(3);
  });
});

test("TEACH_HELP names the command and the length rule", () => {
  expect(TEACH_HELP).toContain("/teach");
  expect(TEACH_HELP).toContain(TEACH_LENGTH_RULE);
  expect(TEACH_LENGTH_RULE).toContain(String(TEACH_MAX_WORDS));
});
