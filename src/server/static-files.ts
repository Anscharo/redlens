import { config } from "./config.ts";
import { NOT_FOUND } from "./http.ts";
import { contentTypeFor } from "./bundle-store.ts";

// Cache-Control for files served from dist/. /assets/* is content-hashed, so it
// is immutable; /sw.js and the manifest must revalidate. The flat mutable JSON
// artifacts get no header on purpose.
const IMMUTABLE_ASSET = { "Cache-Control": "public, max-age=31536000, immutable" };
const REVALIDATE = { "Cache-Control": "no-cache" };

function staticCacheControl(pathname: string): Record<string, string> {
  if (pathname.startsWith("/assets/")) return IMMUTABLE_ASSET;
  if (pathname === "/sw.js" || pathname === "/manifest.webmanifest") return REVALIDATE;
  return {};
}

// A file from dist/, or null when `pathname` is not a file-like miss and the
// caller should fall through to the SPA HTML. Prefers a pre-compressed .gz
// sibling for gzip clients; Content-Type stays that of the original file.
// `Vary` keeps shared caches from mixing the identity and gzip bodies.
export async function serveStaticFile(req: Request, pathname: string): Promise<Response | null> {
  const filePath = config.distDir + pathname;
  const cache = staticCacheControl(pathname);
  if (req.headers.get("accept-encoding")?.includes("gzip")) {
    const gz = Bun.file(filePath + ".gz");
    if (await gz.exists()) {
      const headers = { "Content-Encoding": "gzip", "Content-Type": contentTypeFor(pathname), "Vary": "Accept-Encoding", ...cache };
      return new Response(gz, { headers });
    }
  }
  const file = Bun.file(filePath);
  if (await file.exists()) return new Response(file, { headers: { Vary: "Accept-Encoding", ...cache } });
  // A missing file-like path (final segment has an extension) is a clean 404:
  // SPA HTML under a .js URL becomes a MIME-type import error. The client
  // handles the miss (src/lib/staleChunk.ts). SPA routes never end in an extension.
  return /\.[^/]+$/.test(pathname) ? NOT_FOUND() : null;
}
