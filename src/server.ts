import { resolve } from "node:path";

const DIST = resolve(import.meta.dir, "../dist");
const PORT = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url);

    if (pathname === "/health") {
      return Response.json({ status: "ok" });
    }

    // Try to serve the exact static file first (Bun infers Content-Type from
    // the extension, so no MIME map needed).
    const file = Bun.file(DIST + pathname);
    if (await file.exists()) return new Response(file);

    // SPA fallback — any non-asset path returns index.html so wouter routes
    // resolve client-side.
    return new Response(Bun.file(DIST + "/index.html"));
  },
});

console.log(`Listening on :${server.port}`);
