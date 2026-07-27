// readMeta's error branch (missing/corrupt meta.json → null). The happy path +
// most of cache.ts is covered in preview.test.ts.
import { test, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readMeta, previewPaths } from "./cache.ts";

test("readMeta returns null when meta.json is missing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pv-rm-"));
  expect(readMeta("nope", root)).toBeNull();
  fs.rmSync(root, { recursive: true, force: true });
});

test("readMeta returns null on corrupt JSON", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pv-rm-"));
  const p = previewPaths("bad", root);
  fs.mkdirSync(p.dir, { recursive: true });
  fs.writeFileSync(p.metaPath, "{not json");
  expect(readMeta("bad", root)).toBeNull();
  fs.rmSync(root, { recursive: true, force: true });
});
