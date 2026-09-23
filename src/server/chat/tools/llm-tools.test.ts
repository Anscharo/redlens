// Tool-call adapter tests. Run under `bun test`.
import { expect, test, mock } from "bun:test";
import { applyChatToolBudget, CHAT_TOOLS } from "./llm-tools.ts";
import { TOOLS_BY_NAME } from "./tool-registry.ts";
import { EXPORT_TOOL_NAME } from "./export-tool.ts";
import { ASK_EXTERNAL_MSC } from "./external-tools.ts";
import { buildIndexes } from "../../retrieval/indexes.ts";

test("ask_external_msc is chat-only; external_msc is MCP-only", () => {
  expect(CHAT_TOOLS.some((t) => t.type === "function" && t.function.name === ASK_EXTERNAL_MSC)).toBe(true);
  expect(TOOLS_BY_NAME.has(ASK_EXTERNAL_MSC)).toBe(false);
  expect(CHAT_TOOLS.some((t) => t.type === "function" && t.function.name === "external_msc")).toBe(false);
});

test("export_findings is a chat-only tool: in CHAT_TOOLS but NOT the shared MCP registry", () => {
  expect(CHAT_TOOLS.some((t) => t.type === "function" && t.function.name === EXPORT_TOOL_NAME)).toBe(true);
  expect(TOOLS_BY_NAME.has(EXPORT_TOOL_NAME)).toBe(false);
});


test("applyChatToolBudget leaves small payloads unchanged", () => {
  const raw = JSON.stringify({ ok: true, results: ["small"] });
  const out = applyChatToolBudget(raw, 1_000);

  expect(out.content).toBe(raw);
  expect(out.truncated).toBe(false);
  expect(out.originalChars).toBe(raw.length);
  expect(out.returnedChars).toBe(raw.length);
});

test("applyChatToolBudget wraps oversized payloads with truncation metadata", () => {
  const raw = JSON.stringify({ results: Array.from({ length: 80 }, (_, i) => ({ i, text: "x".repeat(30) })) });
  const out = applyChatToolBudget(raw, 500);
  const parsed = JSON.parse(out.content) as Record<string, unknown>;

  expect(out.truncated).toBe(true);
  expect(out.originalChars).toBe(raw.length);
  expect(out.returnedChars).toBeLessThanOrEqual(500);
  expect(parsed.truncated).toBe(true);
  expect(parsed.original_chars).toBe(raw.length);
  expect(parsed.returned_chars).toBe(out.returnedChars);
  expect(typeof parsed.hint).toBe("string");
  expect(typeof parsed.preview_json).toBe("string");
});

test("execToolDetailed still runs a call carrying an unrecognized arg key (never .strict()), and captures chat_tool_arg_stripped for it", async () => {
  const events: { event: string; properties?: Record<string, unknown> }[] = [];
  // Stand in for posthog-node.ts so captureEvent is observable instead of the
  // real (possibly key-configured, network-touching) client — see mcp.test.ts's
  // stub for the same reasoning. Re-imported below with a cache-busting query
  // string so this fresh llm-tools.ts module instance resolves through it
  // regardless of what earlier test files already cached.
  mock.module("../../posthog-node.ts", () => ({
    getPosthog: () => null,
    captureError: () => {},
    captureEvent: (event: string, _ctx?: unknown, properties?: Record<string, unknown>) => {
      events.push({ event, properties });
    },
    shutdownPosthog: async () => {},
  }));
  const { execToolDetailed: freshExecToolDetailed } = await import(`./llm-tools.ts?argstripped=${Date.now()}`);
  const ix = buildIndexes([], [], [], {});

  const result = await freshExecToolDetailed(
    ix,
    "atlas_get",
    JSON.stringify({ id: "nope", bogus_extra_key: "x" }),
  );
  // Unknown keys are dropped by zod's safeParse, not rejected — the call still runs.
  expect(typeof result.content).toBe("string");
  expect(JSON.parse(result.content)).toEqual({ error: "Not found" });

  const stripped = events.find((e) => e.event === "chat_tool_arg_stripped");
  expect(stripped?.properties).toMatchObject({ tool: "atlas_get", keys: ["bogus_extra_key"] });
});

test("execToolDetailed does not capture chat_tool_arg_stripped when every arg key is recognized", async () => {
  const events: { event: string; properties?: Record<string, unknown> }[] = [];
  mock.module("../../posthog-node.ts", () => ({
    getPosthog: () => null,
    captureError: () => {},
    captureEvent: (event: string, _ctx?: unknown, properties?: Record<string, unknown>) => {
      events.push({ event, properties });
    },
    shutdownPosthog: async () => {},
  }));
  const { execToolDetailed: freshExecToolDetailed } = await import(`./llm-tools.ts?argstripped=${Date.now()}`);
  const ix = buildIndexes([], [], [], {});

  await freshExecToolDetailed(ix, "atlas_get", JSON.stringify({ id: "nope" }));
  expect(events.find((e) => e.event === "chat_tool_arg_stripped")).toBeUndefined();
});

// A model that fills every property can write "" / [] for an unset string or
// array, but has no unset value for a number or an enum — those get null.
test("tools that read empty args as absent offer null exactly on their optional number/enum properties without a default", () => {
  const params = (name: string) =>
    (CHAT_TOOLS.find((t) => t.type === "function" && t.function.name === name) as unknown as { function: { parameters: { properties: Record<string, Record<string, unknown>> } } })
      .function.parameters.properties;
  const aq = params("atlas_query");
  expect(aq.recent_commits.type).toEqual(["integer", "null"]);
  expect(aq.change_type.type).toEqual(["string", "null"]);
  // Both vocabularies (2026-09-23): the history tools say modified/moved, this
  // tool historically took the stored content/structural names, and query.ts
  // normalizes either — so the enum carries all six plus the null-for-unset.
  expect(aq.change_type.enum).toEqual(["added", "modified", "removed", "moved", "content", "structural", null]);
  expect(aq.direction.enum).toContain(null);
  // Strings keep "" as their unset value (a null there made gemma send query:null);
  // defaulted fields keep their default.
  for (const k of ["query", "entity", "since", "status", "ancestor_id"]) expect(aq[k].type).toBe("string");
  expect(aq.edge_types.type).toBe("array");
  expect(aq.k.type).toBe("integer");
  expect(aq.enrich.type).toBe("boolean");
  expect(params("atlas_first_seen").event.enum).toContain(null);
  expect(params("atlas_first_seen").ids.type).toBe("array");
  expect(JSON.stringify([aq, params("atlas_first_seen")])).not.toContain("nullable");
  // The history tools opted in on 2026-09-23 for the same reason, so their
  // change_type now carries the null too.
  expect(params("atlas_changed_between").change_type.enum).toContain(null);
  expect(params("atlas_recent_changes").change_type.enum).toContain(null);
  expect(params("atlas_history").change_type.enum).toContain(null);
  // A tool that did NOT opt in is untouched.
  expect(params("atlas_entity").kind?.type ?? "string").toBe("string");
});
