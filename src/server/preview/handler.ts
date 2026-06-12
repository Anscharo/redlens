// HTTP surface for the preview feature, dispatched from index.ts's fetch
// fallback (dynamic :id/:sha segments + needs server.requestIP, so not the
// static routes object). Three endpoints under /api/preview/:
//   GET /:id/events           SSE build-status stream (drives the build)
//   GET /:sha/diff.json        added/changed doc ids vs current main
//   GET /:sha/<artifact>.json  allowlisted bundle artifact
//
// Disabled unless config.previewEnabled.

import fs from "node:fs";
import path from "node:path";
import type { Server } from "bun";
import { config } from "../config.ts";
import { getIndexes } from "../indexes.ts";
import { diffDocs } from "../atlas-refresh.ts";
import type { AtlasNode } from "../indexes.ts";
import { decodeId, gateError, makeGhClient, resolveRef, type Resolved } from "./resolve.ts";
import { getOrStartBuild, subscribeBuild, type PreviewEvent } from "./build.ts";
import { previewPaths, artifactPath, bundleReady, touch, remove as removeBundle } from "./cache.ts";
import { getPreviewRow, touchPreview, isBlockedSha } from "./db.ts";

const SHA_RE = /^[0-9a-f]{40}$/i;
// noindex on every preview response: unreviewed (possibly fork) content must
// never be search-indexed under our domain (SEO-laundering defense).
const CORS = { "access-control-allow-origin": "*", "x-robots-tag": "noindex" };
const gh = makeGhClient(config.githubToken);

// Resolution TTL cache (per raw id). Tracks the branch/PR tip so a pushed commit
// is picked up within ~60s without re-hitting GitHub on every request.
type ResolveResult = Resolved | { error: "gate-rejected" | "not-found" };
const resolveCache = new Map<string, { at: number; v: ResolveResult }>();
const RESOLVE_TTL_MS = 60_000;

// Per-IP fixed window on the build-triggering events endpoint.
const ipHits = new Map<string, { n: number; reset: number }>();
const IP_WINDOW_MS = 10 * 60_000;
const IP_LIMIT = 30;
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const w = ipHits.get(ip);
  if (!w || now > w.reset) {
    ipHits.set(ip, { n: 1, reset: now + IP_WINDOW_MS });
    return false;
  }
  w.n++;
  return w.n > IP_LIMIT;
}

// Diff cache keyed by (preview sha, current main atlas sha).
const diffCache = new Map<string, { added: string[]; changed: string[] }>();

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
        }
      : { error: "not-found" };
  } else if (gateError(parsed)) {
    v = { error: "gate-rejected" };
  } else {
    v = await resolveRef(parsed, gh);
  }
  resolveCache.set(rawId, { at: now, v });
  return v;
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
  ...CORS,
};

function eventsResponse(rawId: string, ip: string): Response {
  let unsub: () => void = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        unsub();
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
      void drive(rawId, ip, send).then((u) => {
        unsub = u;
      });
    },
    cancel() {
      unsub();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}

// Returns the unsubscribe fn for the SSE stream (noop if it terminated synchronously).
async function drive(rawId: string, ip: string, send: (ev: PreviewEvent) => void): Promise<() => void> {
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

function diffResponse(sha: string): Response {
  if (!bundleReady(sha)) return json({ error: "not-found" }, 404);
  // PR previews ship an accurate diff.json in the bundle (GitHub PR files);
  // serve it directly. Branch/sha previews fall through to the vs-main hash diff.
  const bundleDiff = path.join(previewPaths(sha).outDir, "diff.json");
  if (fs.existsSync(bundleDiff)) {
    return new Response(Bun.file(bundleDiff), { headers: { "Content-Type": "application/json", ...CORS } });
  }
  const ix = getIndexes();
  if (ix.docMap.size === 0) return json({ error: "main-not-ready" }, 503);
  const mainSha = ix.meta.atlasCommit ?? "unknown";
  const key = `${sha}:${mainSha}`;
  let diff = diffCache.get(key);
  if (!diff) {
    const previewNodes = Object.values(
      JSON.parse(fs.readFileSync(path.join(previewPaths(sha).outDir, "docs.json"), "utf8")).nodes,
    ) as AtlasNode[];
    const delta = diffDocs(ix.docMap, previewNodes);
    diff = { added: delta.added.map((n) => n.id), changed: delta.changed.map((n) => n.id) };
    diffCache.set(key, diff);
  }
  return json(diff, 200);
}

async function artifactResponse(sha: string, name: string): Promise<Response> {
  const p = artifactPath(sha, name);
  if (!p || !fs.existsSync(p)) return json({ error: "not-found" }, 404);
  touch(sha);
  // meta.json: overlay the live pr_state from the DB (the PR-state worker keeps
  // it current) so banners flip to merged/closed without a rebuild.
  if (name === "meta.json") {
    const meta = JSON.parse(fs.readFileSync(p, "utf8"));
    const row = await getPreviewRow(sha).catch(() => null);
    if (row?.pr_state) meta.prState = row.pr_state;
    return json(meta, 200);
  }
  return new Response(Bun.file(p), { headers: { "Content-Type": "application/json", ...CORS } });
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

/** Dispatch /api/preview/* . pathname includes the leading "/api/preview/". */
export function handlePreview(req: Request, server: Server, pathname: string): Response | Promise<Response> {
  if (!config.previewEnabled) return json({ error: "not-found" }, 404);
  const rest = pathname.slice("/api/preview/".length);
  const segs = rest.split("/").filter(Boolean);
  if (segs.length !== 2) return json({ error: "not-found" }, 404);
  const [a, b] = segs;

  if (b === "events") {
    const ip = server.requestIP(req)?.address ?? "unknown";
    return eventsResponse(decodeURIComponent(a), ip);
  }
  // artifact + diff endpoints are sha-keyed
  if (!SHA_RE.test(a)) return json({ error: "not-found" }, 404);
  if (b === "diff.json") return diffResponse(a.toLowerCase());
  return artifactResponse(a.toLowerCase(), b);
}
