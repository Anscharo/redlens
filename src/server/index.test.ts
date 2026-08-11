// Run under `bun test` (NOT vitest) — index.ts (and transitively almost every
// server module) imports Bun's SQL via ./db.ts. See CLAUDE.md's coverage note:
// this file exercises src/server/index.ts, which was the single 0%-covered
// hole in the "Backend routes" meter because nothing ever imported it — it was
// only ever launched as `bun src/server/index.ts`. handleRequest is the
// extracted fetch body; every boot side effect (Bun.serve, migrations, the
// updater, the sync-seed spawn, …) is gated behind `if (import.meta.main)` in
// index.ts and is deliberately NOT exercised here — see coverage-areas.mjs
// and index.ts's own comment above that guard.
//
// Deliberately does NOT mock.module ./mcp.ts, ./og-image.ts, ./atlas-static.ts,
// or ./preview/handler.ts, even though index.ts imports all four and a couple
// of their routes would otherwise be easy to force into a specific branch.
// bun's mock.module(spec, factory) patches the module registry for the REST OF
// THE PROCESS (see scripts/aux/audit-mock-modules.mjs's header) — and a live
// import binding is READ at call time, not import time, so it does not matter
// whether this file or the target's own dedicated test file "runs first" in
// `bun test src/server`: verified empirically (two throwaway files, one
// registering a mock.module, the other doing a plain import and reading it
// inside a test body — the plain-import file saw the mock regardless of the
// order bun was given the two files in, and saw the REAL module when run
// alone). Concretely, mocking ./mcp.ts or ./og-image.ts here would silently
// break mcp.test.ts's / og-image.test.ts's own assertions about their real
// exports. Where a branch genuinely needs to be forced (the MCP success path;
// the OG-image fallback), this file uses narrower techniques that can't leak
// into those files — see the comments at each site below.
import { describe, it, expect, beforeEach, afterEach, afterAll, mock } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import type { Server } from "bun";
import { config } from "./config.ts";
import { buildIndexes, setIndexes, getIndexes, rebuildFromDisk } from "./retrieval/indexes.ts";
import { broadcastAtlasUpdate } from "./sse.ts";
import { renderCard } from "./og-image.ts";

// ---------------------------------------------------------------------------
// /mcp success-path setup. Two independent pieces:
//
// 1. WebStandardStreamableHTTPServerTransport is mocked. index.ts is the ONLY
//    importer of this specifier anywhere in the repo (no dedicated test file
//    exists for it), so replacing it cannot affect any other test file.
// 2. mcp.test.ts globally — and, per mock.module's own contract, irreversibly
//    — replaces @modelcontextprotocol/sdk/server/mcp.js's McpServer with a
//    minimal test double that has no connect() method (it never calls one:
//    its tests only invoke the tool callbacks it captures). That's inert for
//    mcp.test.ts, but it means createMcpServer() here (the real, unmocked
//    ./mcp.ts — mocking that file ourselves would be the same cross-file
//    hazard in reverse) can return an object whose /mcp dispatch (`await
//    mcp.connect(transport)`) has nothing to call, purely as an artifact of
//    running in the same `bun test` process — the real SDK class always has
//    .connect() (node_modules/@modelcontextprotocol/sdk .../protocol.js), so
//    production is never affected. A minimal connect() is patched onto the
//    prototype ONLY when missing, so this is a no-op in an isolated run (the
//    real class already has one) and for every other file (nothing needs
//    connect() to be absent — it's a pure addition, never an override).
const realTransportNs = await import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js");
let fakeMcpHandleRequest: ((req: Request) => Promise<Response>) | null = null;
class FakeStreamableTransport {
  sessionIdGenerator: unknown;
  onclose?: () => void;
  onerror?: (e: unknown) => void;
  onmessage?: (m: unknown, extra?: unknown) => void;
  constructor(opts: { sessionIdGenerator?: unknown } = {}) {
    this.sessionIdGenerator = opts.sessionIdGenerator;
  }
  async start(): Promise<void> {}
  async handleRequest(req: Request): Promise<Response> {
    if (fakeMcpHandleRequest) return fakeMcpHandleRequest(req);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
}
mock.module("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js", () => ({
  ...realTransportNs,
  WebStandardStreamableHTTPServerTransport: FakeStreamableTransport,
}));
{
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const proto = (McpServer as unknown as { prototype: Record<string, unknown> }).prototype;
  if (typeof proto.connect !== "function") {
    proto.connect = async function (transport: { start?: () => Promise<void> }) {
      await transport.start?.();
    };
  }
}

const { handleRequest, checkAuthConfig, withCors, ogFallback, handleOgImage, handleOgCard, CORS, NOT_FOUND } =
  await import("./index.ts");

const stubServer = { requestIP: () => ({ address: "1.2.3.4" }) } as unknown as Server<unknown>;

// ---------------------------------------------------------------------------
// Fixture atlas index: one resolvable doc, no entities (so every /radar/<slug>
// is "unknown" — used by the soft-404 test). Real setIndexes()/rebuildFromDisk,
// the same module-state pattern history/freshness.test.ts and mcp.test.ts
// already use — indexes.ts's `state` is a process-global singleton shared by
// every file in this bun test run.
const DOC_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ATLAS_SHA = "test1234567890abcdef1234567890abcdef1234";
setIndexes(
  buildIndexes(
    [
      {
        id: DOC_ID,
        doc_no: "T.1",
        title: "Test Doc",
        type: "Core",
        depth: 1,
        parentId: null,
        content: "Test content for the SPA fallback OG tag test.",
        order: 0,
        addressRefs: [],
      },
    ],
    [],
    [],
    { atlasCommit: ATLAS_SHA },
  ),
);

// Fixture dist/ dir: index.html with the real placeholder tokens, a static
// icon for the OG fallback, and a couple of static assets (one gzip-paired,
// one not) for the static-file-serving branch. No real dist/ build exists in
// this checkout (frontend `vite build` is off the server test path), so this
// is the only way to exercise handleRequest's static + SPA-fallback branches
// at all.
const distDir = fs.mkdtempSync(path.join(os.tmpdir(), "index-test-dist-"));
const origDistDir = config.distDir;
config.distDir = distDir;
fs.writeFileSync(
  path.join(distDir, "index.html"),
  "<!doctype html><html><head>{{OG_TAGS}}</head><body>" +
    '<script>window.__ATLAS_SHA__="{{ATLAS_SHA}}";window.__USERS_ENABLED__={{USERS_ENABLED}};' +
    'window.__CHAT_ENABLED__={{CHAT_ENABLED}};window.__AUTH_PROVIDERS__="{{AUTH_PROVIDERS}}";</script>' +
    "</body></html>",
);
fs.writeFileSync(path.join(distDir, "icon-mid.png"), Buffer.from("fake-icon-bytes"));
fs.mkdirSync(path.join(distDir, "assets"), { recursive: true });
fs.writeFileSync(path.join(distDir, "assets", "plain.txt"), "plain file, no gzip sibling");
fs.writeFileSync(path.join(distDir, "assets", "gz.js"), "// uncompressed sibling should never be served here");
fs.writeFileSync(path.join(distDir, "assets", "gz.js.gz"), zlib.gzipSync(Buffer.from("gzipped-content")));

// Whether the native OG-image toolchain (satori + @resvg/resvg-js) is usable
// in this environment — mirrors og-image.test.ts's own probe exactly (same
// technique, independent probe; renderCard has no shared cache to seed/thrash
// between the two files). "Did it produce a PNG?" is a capability question in
// a sandboxed environment, not a product assertion.
const renderable = (await renderCard({ kind: "default" })) !== null;

afterAll(() => {
  config.distDir = origDistDir;
  fs.rmSync(distDir, { recursive: true, force: true });
  // Restore the REAL on-disk artifacts so later-scheduled test files (bun
  // does not guarantee file order — see atlas-updater.test.ts) don't inherit
  // this file's single-doc fixture. Mirrors history/freshness.test.ts's own
  // restore-and-self-check.
  const restored = rebuildFromDisk();
  if (restored.docMap.size === 0) {
    throw new Error("index.test.ts: rebuildFromDisk() restored an empty docMap — public/ atlas artifacts are missing");
  }
  if (getIndexes() !== restored) throw new Error("index.test.ts: index restore did not take effect");
});

describe("NOT_FOUND", () => {
  it("is a bare 404 with no body", async () => {
    const res = NOT_FOUND();
    expect(res.status).toBe(404);
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });
});

describe("withCors", () => {
  it("applies every CORS header while preserving status, statusText, and existing headers", async () => {
    const original = new Response("body-text", { status: 201, statusText: "Created", headers: { "content-type": "text/plain" } });
    const wrapped = withCors(original);
    expect(wrapped.status).toBe(201);
    expect(wrapped.statusText).toBe("Created");
    expect(wrapped.headers.get("content-type")).toBe("text/plain");
    for (const [k, v] of Object.entries(CORS)) expect(wrapped.headers.get(k)).toBe(v);
    expect(await wrapped.text()).toBe("body-text");
  });

  it("overwrites a pre-existing conflicting CORS header rather than merging it", () => {
    const original = new Response(null, { headers: { "access-control-allow-origin": "https://evil.example" } });
    expect(withCors(original).headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("checkAuthConfig", () => {
  // usersEnabled/usersRequested are read-only in production (derived once
  // from env at config.ts's own import), but config is a plain mutable
  // object — same technique db.test.ts uses on config.databaseUrl.
  const FIELDS = ["usersRequested", "jwtSecret", "githubClientId", "githubClientSecret", "googleClientId", "googleClientSecret", "appUrl", "usersEnabled"] as const;
  let saved: Record<string, unknown>;
  beforeEach(() => {
    saved = {};
    for (const f of FIELDS) saved[f] = (config as Record<string, unknown>)[f];
  });
  afterEach(() => {
    for (const f of FIELDS) (config as Record<string, unknown>)[f] = saved[f];
  });

  function warningsFrom(fn: () => void): string[] {
    const out: string[] = [];
    const real = console.warn;
    console.warn = (...args: unknown[]) => void out.push(args.join(" "));
    try {
      fn();
    } finally {
      console.warn = real;
    }
    return out;
  }

  it("stays silent when logins were never requested — the common case", () => {
    config.usersRequested = false;
    expect(warningsFrom(() => checkAuthConfig())).toEqual([]);
  });

  it("warns about a missing JWT secret and no OAuth provider together, and names the callback URI", () => {
    config.usersRequested = true;
    config.jwtSecret = "";
    config.githubClientId = "";
    config.githubClientSecret = "";
    config.googleClientId = "";
    config.googleClientSecret = "";
    config.appUrl = "https://example.test";
    const warnings = warningsFrom(() => checkAuthConfig());
    expect(warnings.some((w) => w.includes("CHAT_JWT_SECRET unset"))).toBe(true);
    expect(warnings.some((w) => w.includes("no OAuth provider configured"))).toBe(true);
    expect(warnings.some((w) => w.includes("redirect URI in use: https://example.test/api/auth/<provider>/callback"))).toBe(true);
  });

  it("warns about a half-configured second provider even with one complete pair already satisfying the OAuth check — the opaque-400 bug this guards", () => {
    // github alone is a mismatched pair, so on its own it would trip the
    // broader "no OAuth provider configured" branch instead (neither github
    // nor google evaluates truthy) — a fully-configured google is what routes
    // execution into the per-field mismatch checks that catch github's typo.
    config.usersRequested = true;
    config.jwtSecret = "secret";
    config.githubClientId = "id-only";
    config.githubClientSecret = "";
    config.googleClientId = "google-id";
    config.googleClientSecret = "google-secret";
    const warnings = warningsFrom(() => checkAuthConfig());
    expect(warnings.some((w) => w.includes("GITHUB_CLIENT_ID set but GITHUB_CLIENT_SECRET missing"))).toBe(true);
    expect(warnings.some((w) => w.includes("no OAuth provider configured"))).toBe(false);
    expect(warnings.some((w) => w.includes("CHAT_JWT_SECRET unset"))).toBe(false);
  });

  it("stays silent when fully configured with one complete provider pair", () => {
    config.usersRequested = true;
    config.jwtSecret = "secret";
    config.githubClientId = "id";
    config.githubClientSecret = "secret2";
    config.googleClientId = "";
    config.googleClientSecret = "";
    expect(warningsFrom(() => checkAuthConfig())).toEqual([]);
  });
});

describe("ogFallback", () => {
  it("serves the static icon when it exists", async () => {
    const res = await ogFallback();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(await res.text()).toBe("fake-icon-bytes");
  });

  it("degrades to a bare 404 when the static icon itself is missing", async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "index-test-empty-dist-"));
    const orig = config.distDir;
    config.distDir = emptyDir;
    try {
      const res = await ogFallback();
      expect(res.status).toBe(404);
    } finally {
      config.distDir = orig;
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});

describe("handleRequest — CORS preflight", () => {
  it("answers OPTIONS with a bare 204 + CORS headers, for any path", async () => {
    const req = new Request("http://localhost/anything-at-all", { method: "OPTIONS" });
    const res = await handleRequest(req, stubServer);
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toBe(CORS["access-control-allow-methods"]);
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });
});

describe("handleRequest — /api/health", () => {
  it("always answers 200 (liveness), reflecting the seeded index and an unreachable DB", async () => {
    const req = new Request("http://localhost/api/health");
    const res = await handleRequest(req, stubServer);
    // ALWAYS 200 by design (see the route's own comment) — never fails on
    // staleness/DB-down, which would otherwise restart-loop a healthy container.
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.atlas_sha).toBe(ATLAS_SHA);
    expect(body.docs).toBe(1);
    // No Postgres in this test environment (confirmed the same way db.test.ts
    // does — nothing listens on the configured port) — the sync_state read
    // fails fast and evaluateFreshness catches it for real; not mocked.
    expect(body.db_reachable).toBe(false);
    expect(body.status).toBe("degraded");
  });
});

describe("handleRequest — /api/freshness", () => {
  it("status-codes 503 for an uptime monitor while the DB is unreachable", async () => {
    const req = new Request("http://localhost/api/freshness");
    const res = await handleRequest(req, stubServer);
    expect(res.status).toBe(503); // freshnessHttpStatus("degraded")
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("degraded");
    expect(body.dbReachable).toBe(false);
  });
});

describe("handleRequest — /api/atlas-events (SSE)", () => {
  it("registers a client on construction and streams a broadcasted atlas-update event", async () => {
    const req = new Request("http://localhost/api/atlas-events");
    const res = await handleRequest(req, stubServer);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const reader = res.body!.getReader();
    // registerSSEClient runs inside the ReadableStream's start() callback,
    // which the spec fires synchronously during construction — by the time
    // handleRequest has returned, the client is already registered, so this
    // broadcast is guaranteed to reach it (not a race).
    broadcastAtlasUpdate("deadbeef");
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toBe(`event: atlas-update\ndata: ${JSON.stringify({ atlas_sha: "deadbeef" })}\n\n`);
    await reader.cancel();
  });
});

describe("handleRequest — /api/atlas/ dispatch (real handleAtlasStatic, no mock)", () => {
  it("404s a malformed sha", async () => {
    const req = new Request("http://localhost/api/atlas/not-a-real-sha/docs.json");
    const res = await handleRequest(req, stubServer);
    expect(res.status).toBe(404);
  });
});

describe("handleRequest — 404 fallback", () => {
  it("404s a missing file that has an extension, instead of falling through to the SPA shell", async () => {
    const req = new Request("http://localhost/assets/missing.js");
    const res = await handleRequest(req, stubServer);
    expect(res.status).toBe(404);
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });
});

describe("handleRequest — static file serving", () => {
  it("serves the pre-compressed .gz sibling when the client accepts gzip", async () => {
    const req = new Request("http://localhost/assets/gz.js", { headers: { "accept-encoding": "gzip" } });
    const res = await handleRequest(req, stubServer);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Encoding")).toBe("gzip");
    expect(res.headers.get("Content-Type")).toBe("application/javascript");
    const decompressed = zlib.gunzipSync(Buffer.from(await res.arrayBuffer())).toString();
    expect(decompressed).toBe("gzipped-content");
  });

  it("falls through to the plain file when no .gz sibling exists", async () => {
    const req = new Request("http://localhost/assets/plain.txt", { headers: { "accept-encoding": "gzip" } });
    const res = await handleRequest(req, stubServer);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Encoding")).toBeNull();
    expect(await res.text()).toBe("plain file, no gzip sibling");
  });
});

describe("handleRequest — SPA fallback + OG tag substitution", () => {
  it("serves the SPA HTML with per-doc OG tags and the atlas sha injected", async () => {
    const req = new Request(`http://localhost/atlas?id=${DOC_ID}`);
    const res = await handleRequest(req, stubServer);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<title>Test Doc · Sky Atlas by Redline</title>");
    expect(html).toContain(`window.__ATLAS_SHA__="${ATLAS_SHA}"`);
    expect(html).not.toContain("{{OG_TAGS}}");
    expect(html).not.toContain("{{ATLAS_SHA}}");
  });

  it("soft-404s an unresolvable dynamic route (unknown radar actor) but still serves the SPA shell", async () => {
    const req = new Request("http://localhost/radar/some-actor-that-does-not-exist");
    const res = await handleRequest(req, stubServer);
    // isUnknownRoute is true (the fixture index has no entities), but the body
    // is still the real SPA shell — the client renders its own not-found view.
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("<title>Sky Atlas by Redline</title>");
  });

  it("marks preview routes noindex", async () => {
    const req = new Request("http://localhost/preview/184");
    const res = await handleRequest(req, stubServer);
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("falls back to the site-level default tags when indexes can't resolve the doc id", async () => {
    const req = new Request("http://localhost/atlas?id=00000000-0000-0000-0000-000000000000");
    const res = await handleRequest(req, stubServer);
    const html = await res.text();
    expect(html).toContain("<title>Sky Atlas by Redline</title>");
  });
});

describe("handleRequest — OG image routes (fallback-on-error path)", () => {
  it("handleOgImage falls back to the static icon when the id/doc_no doesn't resolve to any node", async () => {
    const req = new Request("http://localhost/api/og/00000000-0000-0000-0000-000000000000.png");
    const res = await handleRequest(req, stubServer);
    expect(res.status).toBe(200); // fixture icon-mid.png exists — see distDir setup
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(await res.text()).toBe("fake-icon-bytes");
  });

  it("handleOgImage resolves a real node and produces a genuine (non-fallback) response when rendering is available", async () => {
    const req = new Request(`http://localhost/api/og/${DOC_ID}.png`);
    const res = await handleRequest(req, stubServer);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    if (renderable) {
      // A real PNG, not the fixture icon's literal bytes.
      expect(await res.text()).not.toBe("fake-icon-bytes");
    } else {
      // No native satori/resvg binary here — og-image.ts's own documented
      // degrade (null return) — handleOgImage falls through to the same
      // static-icon fallback as the unresolvable-id case above.
      expect(await res.text()).toBe("fake-icon-bytes");
    }
  });

  it("handleOgCard renders a real card when the native toolchain is available, or falls back when it isn't", async () => {
    const req = new Request("http://localhost/api/og.png?kind=connect");
    const res = await handleRequest(req, stubServer);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    if (renderable) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(Buffer.from(bytes.subarray(0, 8)).toString("hex")).toBe("89504e470d0a1a0a"); // PNG magic
    } else {
      expect(await res.text()).toBe("fake-icon-bytes");
    }
  });
});

describe("handleRequest — direct handleOgImage/handleOgCard exports", () => {
  it("handleOgImage is independently callable with just a URL (no full request needed)", async () => {
    const res = await handleOgImage(new URL("http://localhost/api/og/unresolvable-id.png"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("fake-icon-bytes");
  });

  it("handleOgCard is independently callable with just a URL", async () => {
    const res = await handleOgCard(new URL("http://localhost/api/og.png?kind=nonsense"));
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });
});

describe("handleRequest — /mcp", () => {
  afterEach(() => {
    fakeMcpHandleRequest = null;
  });

  it("rejects non-POST with 405 + CORS headers, without touching any MCP machinery", async () => {
    const req = new Request("http://localhost/mcp", { method: "GET" });
    const res = await handleRequest(req, stubServer);
    expect(res.status).toBe(405);
    expect(await res.text()).toBe("Method Not Allowed");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("echoes a client-supplied mcp-session-id and applies withCors to the transport's response", async () => {
    fakeMcpHandleRequest = async () => new Response('{"jsonrpc":"2.0","id":1,"result":{}}', { status: 200 });
    const req = new Request("http://localhost/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", "mcp-session-id": "client-supplied-id" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    const res = await handleRequest(req, stubServer);
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBe("client-supplied-id");
    expect(res.headers.get("access-control-allow-origin")).toBe("*"); // withCors applied
  });

  it("mints a fresh mcp-session-id when the client sends none", async () => {
    const req = new Request("http://localhost/mcp", { method: "POST", body: "{}" });
    const res = await handleRequest(req, stubServer);
    const sid = res.headers.get("mcp-session-id");
    expect(sid).toBeTruthy();
    expect(sid).not.toBe("client-supplied-id");
  });
});

describe("/z PostHog reverse proxy dispatch", () => {
  // The proxy is lazy-imported inside handleRequest to keep it off the static
  // hot path, so this also proves that dynamic import resolves. Driven with an
  // endpoint root the proxy does not allow: it rejects at its own allowlist
  // before any outbound fetch, so the dispatch is exercised with no network.
  it("routes /z/<unknown-root> into the proxy, which rejects it", async () => {
    const res = await handleRequest(new Request("http://localhost/z/not-a-posthog-endpoint"), stubServer);
    expect(res.status).toBe(404);
  });

  it("routes bare /z too, not only /z/*", async () => {
    const res = await handleRequest(new Request("http://localhost/z"), stubServer);
    expect(res.status).toBe(404);
  });
});
