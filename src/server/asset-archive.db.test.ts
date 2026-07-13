// Round-trip contract for the asset archive with the DB mocked (the real
// Postgres path is exercised by the Railway CI job's boot migrations): archive
// a fake build dir, then serve a "previous build" request back out — gzip
// negotiation included. Separate file from asset-archive.test.ts because
// mock.module must land before the module under test is imported.
import { describe, it, expect, mock } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const store = new Map<string, { gz: Uint8Array; content_type: string }>();

mock.module("./db.ts", () => ({
  sql: (strings: TemplateStringsArray, ...vals: unknown[]) => {
    const q = strings.join("$");
    if (q.includes("INSERT INTO asset_archive")) {
      store.set(vals[0] as string, { gz: vals[1] as Uint8Array, content_type: vals[2] as string });
      return Promise.resolve([]);
    }
    if (q.includes("DELETE FROM asset_archive")) return Promise.resolve([]);
    if (q.includes("SELECT gz, content_type")) {
      const row = store.get(vals[0] as string);
      return Promise.resolve(row ? [row] : []);
    }
    throw new Error(`unexpected query: ${q}`);
  },
}));

const { archiveDistAssets, serveArchivedAsset } = await import("./asset-archive.ts");

const JS_BODY = 'export default "previous build";\n';

function fakeBuildDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "assets-"));
  writeFileSync(join(dir, "OldChunk-abc12345.js"), JS_BODY);
  writeFileSync(join(dir, "OldStyles-def67890.css"), "body{color:red}");
  // Nested dirs never occur in Vite output but must not crash or archive.
  mkdirSync(join(dir, "nested"));
  return dir;
}

describe("archive → serve round trip", () => {
  it("archives a build dir and serves a stale-tab request from it", async () => {
    const result = await archiveDistAssets(fakeBuildDir());
    expect(result).toEqual({ archived: 2, pruned: 0 });

    // Client accepts gzip → compressed body passes through.
    const gzRes = await serveArchivedAsset(
      "/assets/OldChunk-abc12345.js",
      new Request("http://x/assets/OldChunk-abc12345.js", { headers: { "accept-encoding": "gzip, br" } }),
    );
    expect(gzRes?.headers.get("Content-Encoding")).toBe("gzip");
    expect(gzRes?.headers.get("Content-Type")).toBe("application/javascript");
    expect(gzRes?.headers.get("Cache-Control")).toContain("immutable");
    expect(gunzipSync(Buffer.from(await gzRes!.arrayBuffer())).toString()).toBe(JS_BODY);

    // No gzip support → decompressed on the fly.
    const rawRes = await serveArchivedAsset(
      "/assets/OldChunk-abc12345.js",
      new Request("http://x/assets/OldChunk-abc12345.js"),
    );
    expect(rawRes?.headers.get("Content-Encoding")).toBeNull();
    expect(await rawRes!.text()).toBe(JS_BODY);
  });

  it("misses cleanly on unknown or non-archivable paths", async () => {
    const req = new Request("http://x/");
    expect(await serveArchivedAsset("/assets/Never-Existed.js", req)).toBeNull();
    expect(await serveArchivedAsset("/assets/../index.html", req)).toBeNull();
  });

  it("returns null (quietly) when the build dir is missing", async () => {
    expect(await archiveDistAssets("/nonexistent/assets")).toBeNull();
  });
});
