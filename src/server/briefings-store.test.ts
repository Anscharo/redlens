// The real briefings store against a recording fake of db.ts's `sql`: the
// statements it sends and the guards inside them.
import { describe, it, expect, beforeEach, afterAll, mock } from "bun:test";
import { makeFakeSql } from "./briefings-sql-fake.ts";

const baseExports = { ...(await import("./db.ts")) };
const fake = makeFakeSql();
mock.module("./db.ts", () => ({ ...baseExports, sql: fake.sql }));

const { realStore } = await import("./briefings-store.ts");
const { config } = await import("./config.ts");

// Later files in the process see the real module again.
afterAll(() => void mock.module("./db.ts", () => baseExports));
beforeEach(() => fake.reset());

const write = (n: number, over = {}) => ({
  docId: `0000000${n}-0000-4000-8000-000000000000`,
  briefing: `Briefing ${n}`,
  questions: ["One?", "Two?"],
  digest: `d${n}`,
  contextDigest: `c${n}`,
  model: "m",
  ...over,
});

describe("reads", () => {
  it("loadSnapshot maps atlas_doc_meta rows to nodes", async () => {
    fake.script("FROM sync_state", [{ atlas_sha: "abc" }]);
    fake.script("FROM atlas_doc_meta", [
      { id: "u1", doc_no: "A.1", title: "T", type: "Core", depth: 1, parentId: null, content: "x", order: 0, contentHash: "h", addressRefs: [] },
    ]);
    const snap = await realStore.loadSnapshot();
    expect(snap.atlasSha).toBe("abc");
    expect(snap.docs.map((d) => d.id)).toEqual(["u1"]);
  });

  it("loadSeedHash returns the stored hash, or null when there is no row", async () => {
    fake.script("briefings_seed_hash", [{ briefings_seed_hash: "h1" }]);
    expect(await realStore.loadSeedHash()).toBe("h1");
    fake.reset();
    expect(await realStore.loadSeedHash()).toBeNull();
  });

  it("loadRows keys the rows by doc id", async () => {
    fake.script("FROM atlas_doc_briefings", [{ doc_id: "u1", briefing: "b" }, { doc_id: "u2", briefing: "c" }]);
    const rows = await realStore.loadRows();
    expect([...rows.keys()]).toEqual(["u1", "u2"]);
  });

  it("loadToEmbed asks for rows whose model differs from the configured one", async () => {
    fake.script("FROM atlas_doc_briefings", [{ doc_id: "u1" }]);
    expect(await realStore.loadToEmbed()).toHaveLength(1);
    const call = fake.calls[0]!;
    expect(call.text).toContain("embed_model IS DISTINCT FROM");
    expect(call.text).toContain("embedded_hash IS DISTINCT FROM briefing_hash");
    expect(call.params).toEqual([config.embedModel]);
  });
});

describe("writes", () => {
  it("upsertSeed keeps the vector and its model with unchanged text, and stamps the file hash in the same transaction", async () => {
    await realStore.upsertSeed([write(1), write(2)], "filehash");
    expect(fake.state.begins).toBe(1);
    const [insert, stamp] = fake.calls;
    expect(insert!.via).toBe("unsafe");
    expect(insert!.text).toContain("embed_model = CASE WHEN excluded.briefing_hash = atlas_doc_briefings.briefing_hash THEN atlas_doc_briefings.embed_model");
    expect(insert!.text).toContain("$3::jsonb");
    expect(insert!.text).toContain("$11::jsonb");
    expect(insert!.params).toHaveLength(16);
    expect(insert!.params[2]).toEqual(["One?", "Two?"]); // raw array, not a JSON string
    expect(insert!.params[6]).toBe("seed");
    expect(stamp!.text).toContain("UPDATE sync_state SET briefings_seed_hash");
    expect(stamp!.params).toEqual(["filehash"]);
  });

  it("upsertWorker clears the vector and its model", async () => {
    await realStore.upsertWorker([write(1)]);
    const { text, params } = fake.calls[0]!;
    expect(text).toContain("embedding = NULL, embedded_hash = NULL, embed_model = NULL");
    expect(params[6]).toBe("worker");
    expect(params[7]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("splits a large write into chunks of 400 rows", async () => {
    await realStore.upsertWorker(Array.from({ length: 401 }, (_, i) => write(1, { docId: `${i}` })));
    expect(fake.calls.map((c) => c.params.length)).toEqual([400 * 8, 8]);
  });

  it("bumpFailures counts against the same context and restarts when it moves", async () => {
    await realStore.bumpFailures([{ docId: "u1", digest: "d", contextDigest: "c" }]);
    const { text, params } = fake.calls[0]!;
    expect(text).toContain("failed_context = excluded.failed_context");
    expect(text).toContain("THEN atlas_doc_briefings.failures + 1 ELSE 1");
    expect(params).toEqual(["u1", "d", "c"]);
  });

  it("writeVector sets the model and is guarded on the hash it was embedded from", async () => {
    await realStore.writeVector("u1", "hash1", [0.5, 1]);
    const { text, params } = fake.calls[0]!;
    expect(text).toContain("embed_model =");
    expect(text).toContain("briefing_hash =");
    expect(params).toEqual(["[0.5,1]", config.embedModel, "u1", "hash1"]);
  });
});
