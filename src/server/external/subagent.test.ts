import { test, expect } from "bun:test";
import { runMscSubagent } from "./subagent.ts";
import { MSC_REQUIRED_DISCLAIMER } from "./envelope.ts";
import type { JsonCall } from "../chat/llm.ts";

test("subagent input is only the question + view JSON — no conversation/tool history", async () => {
  let captured: { messages: { role: string; content?: unknown }[] } | null = null;
  const jsonCall: JsonCall = async (params) => {
    captured = { messages: params.messages as { role: string; content?: unknown }[] };
    return {
      text: JSON.stringify({
        figures: [{ name: "To Sky", value: 5, unit: "USD" }],
        notes: "Spark sent 5 to Sky.",
      }),
      usage: { input: 1, output: 1 },
      generationId: null,
      latencyMs: 1,
    };
  };
  const view = {
    source_class: "external",
    not_atlas: true,
    required_disclaimer: MSC_REQUIRED_DISCLAIMER,
    sources: [],
    three_way: { to_sky: 5, supply_kept: 3, demand_side: 0 },
    workbook_url: "https://github.com/soterlabs/settlement-reports/tree/main/reports/spark/2026-07",
  };
  const brief = await runMscSubagent({
    question: "how much to sky?",
    view,
    jsonCall,
  });
  expect(brief.subagent).toBe("ok");
  expect(brief.not_atlas).toBe(true);
  expect(brief.required_disclaimer).toBe(MSC_REQUIRED_DISCLAIMER);
  const blob = JSON.stringify(captured);
  expect(blob).not.toContain("op_html");
  expect(blob).not.toContain("atlas_get");
  expect(captured!.messages).toHaveLength(2);
  expect(captured!.messages[0]!.role).toBe("system");
  expect(captured!.messages[1]!.role).toBe("user");
});

test("subagent fail-closed returns deterministic figures without notes", async () => {
  const jsonCall: JsonCall = async () => {
    throw new Error("timeout");
  };
  const brief = await runMscSubagent({
    question: "q",
    view: {
      required_disclaimer: MSC_REQUIRED_DISCLAIMER,
      sources: [],
      three_way: { to_sky: 9, supply_kept: 1, demand_side: 0 },
    },
    jsonCall,
  });
  expect(brief.subagent).toBe("failed");
  expect((brief.figures as { name: string }[])[0]!.name).toBe("To Sky");
  expect(brief.notes).toBe("");
});
