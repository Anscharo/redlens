// realDeps(): the production dependency bundle of sync:briefings.
import { describe, it, expect, afterAll, mock } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { makeFakeSql } from "./briefings-sql-fake.ts";

const baseDb = { ...(await import("./db.ts")) };
const baseLlm = { ...(await import("./chat/llm.ts")) };
const baseEmbed = { ...(await import("./retrieval/embed.ts")) };
const fake = makeFakeSql();

let reply: unknown = { choices: [{ message: { content: "hi" }, finish_reason: "stop" }] };
let requestArgs: unknown[] = [];
const embedArgs: unknown[][] = [];
mock.module("./db.ts", () => ({ ...baseDb, sql: fake.sql }));
mock.module("./chat/llm.ts", () => ({
  ...baseLlm,
  getClient: () => ({
    chat: { completions: { create: async (...a: unknown[]) => ((requestArgs = a), reply) } },
  }),
}));
mock.module("./retrieval/embed.ts", () => ({
  ...baseEmbed,
  embedBatch: async (...a: unknown[]) => (embedArgs.push(a), [[1]]),
}));

const { realDeps } = await import("./sync-briefings.ts");
const { config } = await import("./config.ts");

afterAll(() => {
  mock.module("./db.ts", () => baseDb);
  mock.module("./chat/llm.ts", () => baseLlm);
  mock.module("./retrieval/embed.ts", () => baseEmbed);
});

describe("realDeps", () => {
  it("reads the seed file from the public directory, or null when it is absent", () => {
    const present = existsSync(join(config.publicDir, "doc-briefings.json"));
    const bytes = realDeps().readSeed();
    expect(bytes === null).toBe(!present);
  });

  it("asks the configured model at temperature 0 and returns text and finish reason", async () => {
    const out = await realDeps().complete("sys", "usr");
    expect(out).toEqual({ content: "hi", finishReason: "stop" });
    const body = requestArgs[0] as { model: string; temperature: number; messages: { role: string }[] };
    expect(body.model).toBe(config.briefingModel);
    expect(body.temperature).toBe(0);
    expect(body.messages.map((m) => m.role)).toEqual(["system", "user"]);
  });

  it("fills in empty content and a null finish reason", async () => {
    reply = { choices: [{ message: {} }] };
    expect(await realDeps().complete("s", "u")).toEqual({ content: "", finishReason: null });
  });

  it("throws when the response has no choices", async () => {
    reply = { error: { message: "rate limited" } };
    await expect(realDeps().complete("s", "u")).rejects.toThrow(/no choices in response.*rate limited/);
  });

  it("embeds documents raw, under the briefing surface", async () => {
    await realDeps().embedBatch(["a"]);
    expect(embedArgs[0]![0]).toEqual(["a"]);
    expect(embedArgs[0]![4]).toBe("embed-briefing");
  });

  it("wires the config and a future deadline", () => {
    const d = realDeps();
    expect(d.model).toBe(config.briefingModel);
    expect(d.perCycle).toBe(config.briefingsPerCycle);
    expect(d.embedBatchSize).toBe(50);
    expect(d.deadlineAt).toBeGreaterThan(d.now());
  });

  it("sleeps for the requested time", async () => {
    const t0 = Date.now();
    await realDeps().sleep(5);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(4);
  });
});
