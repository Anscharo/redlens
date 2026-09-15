import { describe, expect, it, test } from "bun:test";
import { parseTeachCommand, TEACH_HELP, TEACH_MAX_CHARS } from "./parse.ts";

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

  it("caps an oversized body", () => {
    const body = "word ".repeat(TEACH_MAX_CHARS);
    const parsed = parseTeachCommand(`/teach ${body}`)!;
    expect(parsed.text.length).toBe(TEACH_MAX_CHARS);
  });
});

test("TEACH_HELP names the command", () => {
  expect(TEACH_HELP).toContain("/teach");
});
