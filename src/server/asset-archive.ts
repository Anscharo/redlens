// Grace-period serving of previous builds' hashed assets (see migration 014).
// Deploys are atomic container swaps, so the old build's /assets/*.js vanish
// the moment a new one goes live — and any pre-deploy tab breaks on its next
// lazy import (the client-side backstop is src/lib/staleChunk.ts). Postgres is
// the only store that survives deploys, so at boot the web service upserts its
// own dist/assets into asset_archive; the static handler serves disk misses
// from there. A file's last_seen stops advancing once a build no longer ships
// it, so the prune window is "gone from all builds for ASSET_GRACE_DAYS".
import { readdirSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { sql } from "./db.ts";
import { config } from "./config.ts";

const MIME: Record<string, string> = {
  ".js": "application/javascript",
  ".css": "text/css",
  ".map": "application/json",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function assetMime(name: string): string {
  return MIME[extname(name).toLowerCase()] ?? "application/octet-stream";
}

// Only flat, Vite-hashed filenames directly under /assets/ are archivable —
// this is both the upsert filter and the lookup guard on the request path
// (no traversal, no nested paths, no query strings reach the DB).
const ARCHIVABLE_RE = /^\/assets\/[\w.-]+$/;

export function isArchivablePath(pathname: string): boolean {
  return ARCHIVABLE_RE.test(pathname);
}

/** Upsert this build's dist/assets into the archive, then prune files that no
 *  build has shipped for `assetGraceDays`. Missing dist/assets (local dev
 *  without a build) → null, quietly. Runs once at boot, after migrations. */
export async function archiveDistAssets(
  dir = join(config.distDir, "assets"),
): Promise<{ archived: number; pruned: number } | null> {
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    return null;
  }
  let archived = 0;
  for (const name of names) {
    const path = `/assets/${name}`;
    if (!isArchivablePath(path)) continue;
    const gz = gzipSync(readFileSync(join(dir, name)), { level: 9 });
    // Re-shipped path = same hashed content; only last_seen needs refreshing.
    await sql`
      INSERT INTO asset_archive (path, gz, content_type)
      VALUES (${path}, ${gz}, ${assetMime(name)})
      ON CONFLICT (path) DO UPDATE SET last_seen = now()
    `;
    archived++;
  }
  const pruned = await sql`
    DELETE FROM asset_archive
    WHERE last_seen < now() - make_interval(days => ${config.assetGraceDays})
    RETURNING path
  `;
  return { archived, pruned: pruned.length };
}

/** Serve an archived asset for a request whose file is gone from disk, or null
 *  (unknown path / not archivable / DB unavailable — caller decides the 404).
 *  Hashed filenames are immutable, so the response caches forever. */
export async function serveArchivedAsset(pathname: string, req: Request): Promise<Response | null> {
  if (!isArchivablePath(pathname)) return null;
  let rows: { gz: Uint8Array; content_type: string }[];
  try {
    rows = await sql`SELECT gz, content_type FROM asset_archive WHERE path = ${pathname}`;
  } catch {
    return null;
  }
  if (rows.length === 0) return null;
  const { gz, content_type } = rows[0];
  const headers: Record<string, string> = {
    "Content-Type": content_type,
    "Cache-Control": "public, max-age=31536000, immutable",
    Vary: "Accept-Encoding",
  };
  if (req.headers.get("accept-encoding")?.includes("gzip")) {
    return new Response(gz, { headers: { ...headers, "Content-Encoding": "gzip" } });
  }
  return new Response(gunzipSync(gz), { headers });
}
