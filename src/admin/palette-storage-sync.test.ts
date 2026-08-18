// STORAGE_KEY and SCHEMA_VERSION are duplicated in index.html's inline
// pre-paint <script> — it runs before any JS module loads, so it can't import
// this file to share the constants. The header comment at the top of
// palette-storage.ts says "Keep them in sync." This is that guard: if either
// drifts, the pre-paint script silently stops reading/applying the same saved
// overrides and users see a flash of default colors before their palette
// kicks in (or the pre-paint script targets a key readOverrides no longer
// recognizes).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STORAGE_KEY, SCHEMA_VERSION } from "./palette-storage";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const indexHtml = fs.readFileSync(path.join(repoRoot, "index.html"), "utf-8");

describe("index.html pre-paint script stays in sync with palette-storage.ts", () => {
  it("reads localStorage using the same key", () => {
    expect(indexHtml).toContain(`localStorage.getItem("${STORAGE_KEY}")`);
  });

  it("gates on the same schema version", () => {
    expect(indexHtml).toContain(`p.v !== ${SCHEMA_VERSION}`);
  });
});
