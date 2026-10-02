import { describe, expect, it, test } from "bun:test";
import { isUserTeachingTool, summarizeTeachings, TEACH_TOOL_NAME, teachingRound } from "./inject.ts";
import type { RankedTeaching } from "./match.ts";

const hit = (content: string): RankedTeaching => ({
  id: "t1",
  subject: "Spark freeze",
  content,
  score: 1,
  lex: 1,
  ternlight: null,
});

describe("teachingRound", () => {
  it("emits a user_teachings tool round the verifier can label as user", () => {
    const [assistant, tool] = teachingRound("where is freeze?", [hit("Spark freeze lives under Spark")]);
    expect(isUserTeachingTool(TEACH_TOOL_NAME)).toBe(true);
    expect(assistant.role).toBe("assistant");
    expect(tool.role).toBe("tool");
    if (assistant.role !== "assistant" || !("tool_calls" in assistant) || !assistant.tool_calls) {
      throw new Error("expected tool_calls");
    }
    const call = assistant.tool_calls[0]!;
    if (call.type !== "function") throw new Error("expected function tool call");
    expect(call.function.name).toBe(TEACH_TOOL_NAME);
    if (tool.role !== "tool") throw new Error("expected tool");
    const payload = JSON.parse(String(tool.content)) as { note: string; teachings: { subject: string; note: string }[] };
    expect(payload.note).toContain("NOT Atlas");
    expect(payload.teachings).toEqual([{ subject: "Spark freeze", note: "Spark freeze lives under Spark" }]);
  });
});

test("summarizeTeachings is user-facing", () => {
  expect(summarizeTeachings(1)).toBe("1 of your notes");
  expect(summarizeTeachings(3)).toBe("3 of your notes");
});
