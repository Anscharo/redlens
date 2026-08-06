// HTTP surface for the preview feature, dispatched from index.ts's fetch
// fallback (dynamic :id/:sha segments + needs server.requestIP, so not the
// static routes object). Three endpoints under /api/preview/:
//   GET /:id/events           SSE build-status stream (drives the build)
//   GET /:sha/diff.json        added/changed doc ids vs current main
//   GET /:sha/<artifact>.json  allowlisted bundle artifact

import fs from "node:fs";
import path from "node:path";
import type { Server } from "bun";
import { config } from "../config.ts";
import { getIndexes } from "../retrieval/indexes.ts";
import { diffDocs } from "../atlas-refresh.ts";
import type { AtlasNode } from "../retrieval/indexes.ts";
import { CANONICAL_REPO, decodeId, gateError, makeGhClient, resolveRef, type Resolved } from "./resolve.ts";
import { getOrStartBuild, subscribeBuild, type PreviewEvent } from "./build.ts";
import { previewPaths, artifactPath, bundleReady, readMeta, touch, remove as removeBundle } from "./cache.ts";
import { PREVIEW_STORE, serveBundleArtifact } from "../bundle-store.ts";
import { getPreviewRow, touchPreview, isBlockedSha, listPreviews } from "./db.ts";
import { authorizePreviewAccess } from "./access.ts";

const SHA_RE = /^[0-9a-f]{40}$/i;
// noindex on every preview response: unreviewed (possibly fork) content must
// never be search-indexed under our domain (SEO-laundering defense).
const CORS = { "access-control-allow-origin": "*", "x-robots-tag": "noindex" };
// Private-preview responses: NO access-control-allow-origin — a shared
// CDN/proxy must not cache one user's private docs for the next visitor (G6).
const PRIVATE_HEADERS = { "cache-control": "private, no-store", "x-robots-tag": "noindex" };
const gh = makeGhClient(config.githubToken);

// Resolution TTL cache (per raw id). Tracks the branch/PR tip so a pushed commit
// is picked up within ~60s without re-hitting GitHub on every request.
type ResolveResult = Resolved | { error: "gate-rejected" | "not-found" | "not-a-fork" | "app-not-installed" };
const resolveCache = new Map<string, { at: number; v: ResolveResult }>();
const RESOLVE_TTL_MS = 60_000;
const RESOLVE_CACHE_MAX = 1000; // FIFO cap — prevents indefinite growth under scanner traffic

// Per-IP fixed window on the build-triggering events endpoint.
const ipHits = new Map<string, { n: number; reset: number }>();
const IP_WINDOW_MS = 10 * 60_000;
const IP_LIMIT = 30;
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const w = ipHits.get(ip);
  if (!w || now > w.reset) {
    // Sweep expired entries when the map grows large (scanner IPs that never return).
    if (ipHits.size > 5000) {
      for (const [k, v] of ipHits) if (now > v.reset) ipHits.delete(k);
    }
    ipHits.set(ip, { n: 1, reset: now + IP_WINDOW_MS });
    return false;
  }
  w.n++;
  return w.n > IP_LIMIT;
}

// Diff cache keyed by (preview sha, current main atlas sha).
// Exported for the eviction regression test only — not otherwise consumed
// outside this module.
export const diffCache = new Map<string, { added: string[]; changed: string[] }>();
export const DIFF_CACHE_MAX = 1000; // FIFO cap — matches the resolveCache pattern above

// Open PRs against the canonical atlas, for the /preview index "open atlas prs"
// tab. Cached ~5 min — the pulls list is rate-limited and rarely changes, and
// many index visitors would otherwise each spend a GitHub call.
interface OpenPr { number: number; title: string; author: string; draft: boolean; updatedAt: string }
let openPrsCache: { at: number; v: OpenPr[] } | null = null;
const OPEN_PRS_TTL_MS = 5 * 60_000;

async function openAtlasPrs(): Promise<OpenPr[]> {
  const now = Date.now();
  if (openPrsCache && now - openPrsCache.at < OPEN_PRS_TTL_MS) return openPrsCache.v;
  const r = await gh.fetchJson(`/repos/${CANONICAL_REPO}/pulls?state=open&sort=updated&direction=desc&per_page=100`);
  if (!r.ok || !Array.isArray(r.json)) return openPrsCache?.v ?? []; // serve stale on a GitHub hiccup
  const prs: OpenPr[] = r.json.map((p: any) => ({
    number: p.number,
    title: p.title ?? "",
    author: p.user?.login ?? "",
    draft: !!p.draft,
    updatedAt: p.updated_at ?? "",
  }));
  openPrsCache = { at: now, v: prs };
  return prs;
}

async function resolveId(rawId: string): Promise<ResolveResult> {
  const hit = resolveCache.get(rawId);
  const now = Date.now();
  if (hit && now - hit.at < RESOLVE_TTL_MS) return hit.v;

  const parsed = decodeId(rawId);
  let v: ResolveResult;
  if (!parsed) {
    v = { error: "not-found" };
  } else if (parsed.kind === "sha") {
    // Pinned sha: recover repo from the previews table (durability for a wiped bundle).
    const row = await getPreviewRow(parsed.sha);
    v = row
      ? {
          repo: row.repo,
          sha: row.sha,
          kind: "branch",
          ref: row.ref,
          pr: row.pr_number
            ? { number: row.pr_number, title: row.pr_title ?? "", author: row.pr_author ?? "", state: (row.pr_state as any) ?? "open" }
            : undefined,
          private: row.private,
        }
      : { error: "not-found" };
  } else if (gateError(parsed)) {
    // gateError always returns null — reserved for future grammar-level gates
    v = { error: "gate-rejected" };
  } else {
    v = await resolveRef(parsed, gh);
  }
  resolveCache.set(rawId, { at: now, v });
  if (resolveCache.size > RESOLVE_CACHE_MAX) resolveCache.delete(resolveCache.keys().next().value!);
  return v;
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
  ...CORS,
};

// A client cancel/close can land before the async unsubscribe fn is known
// (drive() hasn't resolved yet). Naively assigning `unsub = u` in the .then()
// loses a cancel that already fired against the stale initial noop, leaking
// the subscriber (a dead `send` stays in Inflight.subscribers until the build
// ends). This gate makes "cancel then resolve" and "resolve then cancel" both
// invoke the real unsubscribe exactly once. Exported for the race regression
// test; otherwise internal to eventsResponse.
export function makeUnsubGate(): { resolve: (u: () => void) => void; cancel: () => void } {
  let unsub: (() => void) | null = null;
  let cancelled = false;
  return {
    resolve(u) {
      if (cancelled) {
        u();
        return;
      }
      unsub = u;
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      unsub?.();
    },
  };
}

function eventsResponse(req: Request, rawId: string, ip: string): Response {
  const gate = makeUnsubGate();
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        gate.cancel();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const send = (ev: PreviewEvent) => {
        try {
          controller.enqueue(enc.encode(`event: preview\ndata: ${JSON.stringify(ev)}\n\n`));
        } catch {
          /* downstream gone */
        }
        if (ev.phase === "ready" || ev.phase === "failed") close();
      };
      void drive(req, rawId, ip, send).then((u) => gate.resolve(u));
    },
    cancel() {
      gate.cancel();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}

// Returns the unsubscribe fn for the SSE stream (noop if it terminated synchronously).
async function drive(req: Request, rawId: string, ip: string, send: (ev: PreviewEvent) => void): Promise<() => void> {
  if (rateLimited(ip)) {
    send({ phase: "failed", code: "rate-limited", message: "Too many preview requests — try again shortly." });
    return () => {};
  }
  send({ phase: "resolving" });
  const r = await resolveId(rawId);
  if ("error" in r) {
    send({ phase: "failed", code: r.error });
    return () => {};
  }
  // G3: authorize BEFORE any sha-bearing event (isBlockedSha/bundleReady/build)
  // reaches an unauthorized caller — the resolve cache may still hold a private
  // Resolved (incl. sha), but the authorization decision itself is never cached
  // here; it's re-run per request against the live session/collaborator state.
  if (r.private) {
    const d = await authorizePreviewAccess(req, r.repo);
    if (d !== "ok") {
      send({ phase: "failed", code: d === "login-required" ? "auth-required" : d });
      return () => {};
    }
  }
  const sha = r.sha;
  // Admin takedown: a blocked sha neither serves its cached bundle nor rebuilds.
  if (await isBlockedSha(sha).catch(() => false)) {
    removeBundle(sha);
    send({ phase: "failed", code: "not-found" });
    return () => {};
  }
  if (bundleReady(sha)) {
    touch(sha);
    void touchPreview(sha).catch(() => {});
    send({ phase: "ready", sha });
    return () => {};
  }
  getOrStartBuild(r);
  return subscribeBuild(sha, send);
}

// Resolve serveability + privacy for a sha-keyed response. Gating on bundleReady
// FIRST is load-bearing (G1): artifact files exist on disk before meta.json is
// written, so "no meta yet" MUST read as not-serveable, never as public.
async function gateSha(req: Request, sha: string): Promise<{ ok: true; headers: Record<string, string> } | { deny: Response }> {
  if (!bundleReady(sha)) return { deny: json({ error: "not-found" }, 404) };
  const meta = readMeta(sha);
  if (meta?.private) {
    const d = await authorizePreviewAccess(req, meta.repo);
    if (d === "ok") return { ok: true, headers: PRIVATE_HEADERS };
    if (d === "login-required") return { deny: json({ error: "auth-required" }, 401, PRIVATE_HEADERS) };
    if (d === "forbidden") return { deny: json({ error: "forbidden" }, 403, PRIVATE_HEADERS) };
    return { deny: json({ error: "unavailable" }, 503, PRIVATE_HEADERS) };
  }
  return { ok: true, headers: CORS };
}

async function diffResponse(req: Request, sha: string): Promise<Response> {
  const gated = await gateSha(req, sha);
  if ("deny" in gated) return gated.deny;
  const { headers } = gated;
  // PR previews ship an accurate diff.json in the bundle (GitHub PR files);
  // serve it directly. Branch/sha previews fall through to the vs-main hash diff.
  const bundleDiff = path.join(previewPaths(sha).outDir, "diff.json");
  if (fs.existsSync(bundleDiff)) {
    return new Response(Bun.file(bundleDiff), { headers: { "Content-Type": "application/json", ...headers } });
  }
  const ix = getIndexes();
  if (ix.docMap.size === 0) return json({ error: "main-not-ready" }, 503, headers);
  const mainSha = ix.meta.atlasCommit ?? "unknown";
  const key = `${sha}:${mainSha}`;
  let diff = diffCache.get(key);
  if (!diff) {
    const previewNodes = Object.values(
      JSON.parse(fs.readFileSync(path.join(previewPaths(sha).outDir, "docs.json"), "utf8")).nodes,
    ) as AtlasNode[];
    const delta = diffDocs(ix.docMap, previewNodes);
    diff = { added: delta.added.map((n) => n.id), changed: delta.changed.map((n) => n.id) };
    // Skip caching when atlasCommit is unknown (main not yet loaded) — the key
    // would be "<sha>:unknown" and would serve a stale diff once main loads.
    if (mainSha !== "unknown") {
      diffCache.set(key, diff);
      if (diffCache.size > DIFF_CACHE_MAX) diffCache.delete(diffCache.keys().next().value!);
    }
  }
  return json(diff, 200, headers);
}

async function artifactResponse(req: Request, sha: string, name: string): Promise<Response> {
  const gated = await gateSha(req, sha);
  if ("deny" in gated) return gated.deny;
  const { headers } = gated;
  // meta.json: overlay the live pr_state from the DB (the PR-state worker keeps
  // it current) so banners flip to merged/closed without a rebuild. Computed,
  // not served raw — handled here before the shared bundle reader.
  if (name === "meta.json") {
    const p = artifactPath(sha, name);
    if (!p || !fs.existsSync(p)) return json({ error: "not-found" }, 404, headers);
    touch(sha);
    const meta = JSON.parse(fs.readFileSync(p, "utf8"));
    const row = await getPreviewRow(sha).catch(() => null);
    if (row?.pr_state) meta.prState = row.pr_state;
    return json(meta, 200, headers);
  }
  // Plain artifacts go through the shared bundle reader (path + gzip + 404).
  const res = await serveBundleArtifact(PREVIEW_STORE, sha, name, req, headers);
  if (!res) return json({ error: "not-found" }, 404, headers);
  touch(sha);
  return res;
}

function json(body: unknown, status: number, headers: Record<string, string> = CORS): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

/** Dispatch /api/preview/* . pathname includes the leading "/api/preview/". */
export function handlePreview(req: Request, server: Server<unknown>, pathname: string): Response | Promise<Response> {
  const rest = pathname.slice("/api/preview/".length);
  const segs = rest.split("/").filter(Boolean);
  // GET /api/preview/list — live previews for the /preview index page.
  if (segs.length === 1 && segs[0] === "list") {
    return listPreviews()
      .then((rows) => json(rows, 200))
      .catch(() => json([], 200));
  }
  // GET /api/preview/open-prs — open PRs against the canonical atlas, for the
  // /preview index "open atlas prs" tab.
  if (segs.length === 1 && segs[0] === "open-prs") {
    return openAtlasPrs()
      .then((prs) => json(prs, 200))
      .catch(() => json([], 200));
  }
  if (segs.length !== 2) return json({ error: "not-found" }, 404);
  const [a, b] = segs;

  if (b === "events") {
    let decoded: string;
    try {
      decoded = decodeURIComponent(a);
    } catch {
      // Malformed percent-encoding (e.g. a lone "%E0%A4%A") — not a valid id.
      return json({ error: "not-found" }, 404);
    }
    const ip = server.requestIP(req)?.address ?? "unknown";
    return eventsResponse(req, decoded, ip);
  }
  // artifact + diff endpoints are sha-keyed
  if (!SHA_RE.test(a)) return json({ error: "not-found" }, 404);
  if (b === "diff.json") return diffResponse(req, a.toLowerCase());
  return artifactResponse(req, a.toLowerCase(), b);
}
