// pauAtlasInputs: the PAU rebuild's atlas artifacts come from the set published
// for the sha sync_state points at, and a name the store lacks keeps its public/
// path. The db is a fake tag (the module takes it as a parameter).
import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { pauAtlasInputs } from "./atlas-inputs.ts";

const row = (name: string, body: string) => {
  const raw = Buffer.from(body);
  return { name, gz: gzipSync(raw), raw_bytes: raw.byteLength, sha256: createHash("sha256").update(raw).digest("hex") };
};

/** A db whose sync_state points at `sha` and whose store holds `rows` for it. */
function fakeDb(sha: string | null, rows: ReturnType<typeof row>[]) {
  const asked: unknown[][] = [];
  const db = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    asked.push(values);
    if (strings.join("?").includes("sync_state")) return sha ? [{ atlas_sha: sha }] : [];
    return values[0] === sha ? rows : [];
  };
  return { db, asked };
}

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), "pau-inputs-"));

describe("pauAtlasInputs", () => {
  it("writes the published graph and address artifacts for sync_state's sha and points at them", async () => {
    const { db, asked } = fakeDb("abc", [row("graph.json", '{"entities":[]}'), row("addresses.atlas.json", "{}")]);
    const dir = path.join(scratch(), "out");
    const paths = await pauAtlasInputs(db, { dir, publicDir: "pub" });
    expect(paths).toEqual({ "graph.json": path.join(dir, "graph.json"), "addresses.atlas.json": path.join(dir, "addresses.atlas.json") });
    expect(fs.readFileSync(paths["graph.json"], "utf8")).toBe('{"entities":[]}');
    expect(asked[1]).toEqual(["abc", ["graph.json", "addresses.atlas.json"]]);
  });

  it("keeps the public/ path for a name the store lacks, and for both when sync_state has no sha", async () => {
    const dir = path.join(scratch(), "out");
    const some = await pauAtlasInputs(fakeDb("abc", [row("graph.json", "{}")]).db, { dir, publicDir: "pub" });
    expect(some).toEqual({ "graph.json": path.join(dir, "graph.json"), "addresses.atlas.json": path.join("pub", "addresses.atlas.json") });
    const none = await pauAtlasInputs(fakeDb(null, []).db, { dir, publicDir: "pub" });
    expect(none).toEqual({ "graph.json": path.join("pub", "graph.json"), "addresses.atlas.json": path.join("pub", "addresses.atlas.json") });
  });

  it("refuses a blob whose bytes are not what was published", async () => {
    const bad = { ...row("graph.json", "{}"), sha256: "0".repeat(64) };
    await expect(pauAtlasInputs(fakeDb("abc", [bad]).db, { dir: path.join(scratch(), "out") })).rejects.toThrow("sha256 mismatch");
  });
});
