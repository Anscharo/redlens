import { afterEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openVectorCache } from "./eval-vector-cache.ts";

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "vec-cache-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("openVectorCache", () => {
  it("round-trips through save and reopen", () => {
    const dir = tmp();
    const c = openVectorCache(dir);
    expect(c.size).toBe(0);
    c.set("m\u0000a", [0.5, -0.25, 1]);
    c.set("m\u0000b", [2, 4, 8]);
    expect(c.has("m\u0000a")).toBe(true);
    c.save();
    const again = openVectorCache(dir);
    expect(again.size).toBe(2);
    expect(again.get("m\u0000a")).toEqual([0.5, -0.25, 1]);
    expect(again.get("m\u0000b")).toEqual([2, 4, 8]);
    expect(again.get("missing")).toBeUndefined();
    expect(again.has("missing")).toBe(false);
  });

  it("save does nothing when nothing changed", () => {
    const dir = tmp();
    const c = openVectorCache(dir);
    c.save();
    expect(fs.existsSync(path.join(dir, "eval-vectors.bin"))).toBe(false);
    c.set("k", [1, 2]);
    c.save();
    const before = fs.statSync(path.join(dir, "eval-vectors.idx.json")).mtimeMs;
    fs.rmSync(path.join(dir, "eval-vectors.bin"));
    openVectorCache(dir).save(); // reopened, clean: must not rewrite (and must not crash on the missing pair)
    expect(fs.statSync(path.join(dir, "eval-vectors.idx.json")).mtimeMs).toBe(before);
  });

  it("throws on a dimension mismatch, in memory and on disk", () => {
    const dir = tmp();
    const c = openVectorCache(dir);
    c.set("a", [1, 2, 3]);
    expect(() => c.set("b", [1, 2])).toThrow(/3-dim/);
    c.save();
    expect(() => openVectorCache(dir).set("c", [1])).toThrow(/3-dim/);
    fs.writeFileSync(path.join(dir, "eval-vectors.bin"), new Uint8Array(4));
    expect(() => openVectorCache(dir)).toThrow(/delete both files/);
  });
});
