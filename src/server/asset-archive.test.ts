// Contracts for the grace-period asset archive (no live DB — mirrors the
// history-db test style): migration 014 shape, the archivable-path guard that
// keeps junk requests off the DB, and MIME mapping for the serve path.
import { describe, it, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { assetMime, isArchivablePath } from "./asset-archive.ts";

describe("migration 014 creates asset_archive", () => {
  it("exists and carries the columns the code writes/reads", () => {
    const dir = new URL("./migrations/", import.meta.url);
    const file = readdirSync(dir).find((n) => n.startsWith("014") && n.endsWith(".sql"));
    expect(file).toBeTruthy();
    const ddl = readFileSync(new URL(file!, dir), "utf8").toLowerCase();
    expect(ddl).toContain("asset_archive");
    for (const col of ["path", "gz", "content_type", "first_seen", "last_seen"]) {
      expect(ddl).toContain(col);
    }
  });
});

describe("isArchivablePath", () => {
  it("accepts flat hashed asset paths", () => {
    expect(isArchivablePath("/assets/NodeContentInner-m79m9tmd.js")).toBe(true);
    expect(isArchivablePath("/assets/ConstellationsPage-CHpVij2M.css")).toBe(true);
    expect(isArchivablePath("/assets/index-BVW1POTO.js")).toBe(true);
  });

  it("rejects traversal, nesting, and non-asset paths", () => {
    expect(isArchivablePath("/assets/../index.html")).toBe(false);
    expect(isArchivablePath("/assets/sub/dir.js")).toBe(false);
    expect(isArchivablePath("/assets/")).toBe(false);
    expect(isArchivablePath("/docs.json")).toBe(false);
    expect(isArchivablePath("/assets/a b.js")).toBe(false);
  });
});

describe("assetMime", () => {
  it("maps the extensions Vite emits into assets/", () => {
    expect(assetMime("App-abc.js")).toBe("application/javascript");
    expect(assetMime("App-abc.css")).toBe("text/css");
    expect(assetMime("logo-abc.svg")).toBe("image/svg+xml");
    expect(assetMime("font-abc.woff2")).toBe("font/woff2");
    expect(assetMime("blob-abc.bin")).toBe("application/octet-stream");
  });
});
