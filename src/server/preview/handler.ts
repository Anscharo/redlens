// HTTP surface for the preview feature, dispatched from index.ts's fetch
// fallback (dynamic :id/:sha segments + needs server.requestIP, so not the
// static routes object). Three endpoints under /api/preview/:
//   GET /:id/events           SSE build-status stream (drives the build)
//   GET /:sha/diff.json        added/changed doc ids vs current main
//   GET /:sha/<artifact>.json  allowlisted bundle artifact
//   GET /mine?shas=…&at=…      the caller's own previews: their account history
//                              plus the shas their browser remembers (with that
//                              browser's open time), private rows released only
//                              once access is authorized

import fs from "node:fs";
import path from "node:path";
import type { Server } from "bun";
import { json as httpJson, PREVIEW_CORS } from "../http.ts";
import { createCache } from "../ttl-cache.ts";
import { getIndexes } from "../retrieval/indexes.ts";
import { diffDocs } from "../atlas-refresh.ts";
import type { AtlasNode } from "../retrieval/indexes.ts";
import { decodeId, type Resolved } from "./resolve.ts";
import { getOrStartBuild, subscribeBuild, type PreviewEvent } from "./build.ts";
import { previewPaths, artifactPath, bundleReady, readMeta, writeMeta, touch, type PreviewMeta } from "./cache.ts";
import { IDENTITY_FILES, isRefining } from "./identity-refine.ts";
import { PREVIEW_STORE, serveBundleArtifact } from "../bundle-store.ts";
import { getPreviewRow, touchPreview, recordPreviewOpen } from "./db.ts";
import { parseLocalOpens, visiblePreviews } from "./mine.ts";
import { fillPrivateDiffBaseOnOpen } from "./diff-base-backfill.ts";
import { authorizePreviewAccess } from "./access.ts";
import { getSessionUser } from "../session.ts";
import { appInstallUrl } from "./github-app.ts";
import { rateLimited, mineRateLimited } from "./rate-limit.ts";
import { openAtlasPrs } from "./open-prs.ts";
import { resolveAuthorized, takedownBlocked, needsBaseRebuild } from "./open-gate.ts";

// Split-out modules, re-exported so existing importers keep one entry point.
export { resolveId, resolveCache, RESOLVE_CACHE_MAX } from "./resolve-id.ts";
export { rateLimited, ipHits, IP_LIMIT, mineRateLimited, mineHits, MINE_WINDOW_MS, MINE_LIMIT } from "./rate-limit.ts";

const SHA_RE = /^[0-9a-f]{40}$/i;
// noindex on every preview response: unreviewed (possibly fork) content must
// never be search-indexed under our domain (SEO-laundering defense). Defined
// in http.ts alongside the router's own header set — same home, distinct value:
// this local `CORS` is PREVIEW_CORS (allow-origin + noindex), NOT http.ts's
// `CORS` (the wider MCP preflight set). Don't swap the import.
const CORS = PREVIEW_CORS;
// Private-preview responses: NO access-control-allow-origin — a shared
// CDN/proxy must not cache one user's private docs for the next visitor (G6).
const PRIVATE_HEADERS = { "cache-control": "private, no-store", "x-robots-tag": "noindex" };

// Diff cache keyed by (preview sha, current main atlas sha).
// Exported for the eviction regression test only — not otherwise consumed
// outside this module.
export const DIFF_CACHE_MAX = 1000; // FIFO cap — matches the resolveCache pattern above
export const diffCache = createCache<{ added: string[]; changed: string[] }>({ max: DIFF_CACHE_MAX });

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

// An app-not-installed failure carries the App's install URL so the client can
// offer a one-click "Install the Sky Atlas by Redline GitHub App" action instead of dead-end copy;
// every other failure code has no attached message.
async function failInstallMessage(code: string, repo: string | undefined): Promise<string | undefined> {
  return code === "app-not-installed" ? ((await appInstallUrl(repo).catch(() => null)) ?? undefined) : undefined;
}

/** The repo a preview id names, for targeting the install link at its owner. */
function repoOfId(rawId: string): string | undefined {
  const p = decodeId(rawId);
  return p?.kind === "branch" ? p.repo : undefined;
}

/** Overlay a freshly-resolved All-repos grant flag onto a ready bundle's meta.
 *  The banner reads meta.json, not the resolve, and a same-sha ready bundle
 *  does not rebuild — so without this the ACCESS row would stick until the
 *  commit moved. Only call after resolvePrivateBranch (a SHA/DB resolve never
 *  re-derives the flag, and applying this there would wipe a still-valid row).
 *  Returns the patched meta, or null when nothing changed. */
export function syncBroadGrantMeta(
  meta: PreviewMeta,
  r: Pick<Resolved, "grantTooBroad" | "installSettingsUrl">,
): PreviewMeta | null {
  const want = !!r.grantTooBroad;
  const have = !!meta.grantTooBroad;
  const wantUrl = want ? r.installSettingsUrl : undefined;
  const haveUrl = have ? meta.installSettingsUrl : undefined;
  if (want === have && wantUrl === haveUrl) return null;
  const next: PreviewMeta = { ...meta };
  if (want) {
    next.grantTooBroad = true;
    if (r.installSettingsUrl) next.installSettingsUrl = r.installSettingsUrl;
    else delete next.installSettingsUrl;
  } else {
    delete next.grantTooBroad;
    delete next.installSettingsUrl;
  }
  return next;
}

/** Record a signed-in visitor's open against their ACCOUNT, so /preview's recent
 *  list follows them to their next browser. Anonymous visitors get nothing here —
 *  their localStorage record (previewLocal.ts) is the only one, by design.
 *
 *  Called once per `ready`, which is the earliest point that is true: the sha is
 *  resolved, the takedown check has passed, a private repo has been authorized,
 *  and the build (which upserts the previews row this later JOINs to) is done.
 *  Exported for the test that drives it without an SSE stream. */
export async function rememberPreviewOpen(req: Request, previewId: string, sha: string): Promise<void> {
  const session = await getSessionUser(req);
  if (!session) return;
  // A bare-sha id is case-insensitive (resolveId already lowercases it), so record
  // it lowercased or `/preview/ABC…` and `/preview/abc…` become two rows for one
  // preview. Every other id form keeps its case: a branch name is case-SENSITIVE
  // in git, so `owner:repo:Fix` and `owner:repo:fix` are genuinely different refs.
  await recordPreviewOpen(session.user.id, SHA_RE.test(previewId) ? previewId.toLowerCase() : previewId, sha);
}

// Returns the unsubscribe fn for the SSE stream (noop if it terminated synchronously).
async function drive(req: Request, rawId: string, ip: string, send: (ev: PreviewEvent) => void): Promise<() => void> {
  if (rateLimited(ip)) {
    send({ phase: "failed", code: "rate-limited", message: "Too many preview requests — try again shortly." });
    return () => {};
  }
  send({ phase: "resolving" });
  // G3/G7: open-gate authorizes a private repo BEFORE any sha-bearing event
  // (isBlockedSha/bundleReady/build) reaches an unauthorized caller.
  const opened = await resolveAuthorized(rawId, (repo) => authorizePreviewAccess(req, repo));
  if ("denied" in opened) {
    const d = opened.denied;
    if (d === "login-required" || d === "forbidden" || d === "unavailable") {
      send({ phase: "failed", code: d === "login-required" ? "auth-required" : d });
    } else {
      send({ phase: "failed", code: d, message: await failInstallMessage(d, opened.repo ?? repoOfId(rawId)) });
    }
    return () => {};
  }
  const { r, viaPrivateResolve } = opened;
  const sha = r.sha;
  // Every `ready` this stream emits — from the cached bundle below or from a
  // build — is an open by this visitor, so route them all through one wrapper
  // rather than remembering to record at each site. Fire-and-forget: the
  // account history must never delay, or fail, opening a preview.
  const sendRecording = (ev: PreviewEvent) => {
    if (ev.phase === "ready") void rememberPreviewOpen(req, rawId, sha).catch(() => {});
    send(ev);
  };
  if (await takedownBlocked(sha)) {
    send({ phase: "failed", code: "not-found" });
    return () => {};
  }
  if (bundleReady(sha)) {
    const meta = readMeta(sha);
    if (needsBaseRebuild(r, meta)) {
      getOrStartBuild(r);
      return subscribeBuild(sha, sendRecording);
    }
    // Banner-only: keep ACCESS in sync with the live install without a rebuild.
    // Only a resolvePrivateBranch result carries a fresh repository_selection;
    // a SHA/DB resolve never carries grantTooBroad and would clear a valid row.
    if (meta && viaPrivateResolve) {
      const synced = syncBroadGrantMeta(meta, r);
      if (synced) writeMeta(sha, synced);
    }
    touch(sha);
    void touchPreview(sha).catch(() => {});
    // Disk wiped → the rebuild below records the diff base. Disk still here
    // and the row predates the columns → fill it without making this open wait.
    if (r.private) fillPrivateDiffBaseOnOpen(r, meta);
    sendRecording({ phase: "ready", sha });
    return () => {};
  }
  getOrStartBuild(r);
  return subscribeBuild(sha, sendRecording);
}

// Resolve serveability + privacy for a sha-keyed response. Gating on bundleReady
// FIRST is load-bearing (G1): artifact files exist on disk before meta.json is
// written, so "no meta yet" MUST read as not-serveable, never as public.
async function gateSha(req: Request, sha: string): Promise<{ ok: true; headers: Record<string, string> } | { deny: Response }> {
  if (!bundleReady(sha)) return { deny: json({ error: "not-found" }, 404) };
  const meta = readMeta(sha);
  // bundleReady passed (docs.json + meta.json exist on disk) but the meta didn't
  // parse — a torn/corrupt meta.json. We cannot confirm this bundle is public, so
  // fail closed: serving it with public CORS would leak a private bundle, since
  // sha-keyed URLs are not secret. Treat an unreadable meta as not-serveable.
  if (!meta) return { deny: json({ error: "not-found" }, 404) };
  if (meta.private) {
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
  // Every built bundle ships an accurate diff.json — the `auto` diff-base pair
  // (the PR's own base, the fork's merge base, or live main when neither
  // candidate resolved — see build.ts's diff-artifacts block and
  // PreviewMeta.bases); serve it directly. diff.sky.json / diff.repo.json (the
  // other candidate pairs) are plain allowlisted artifacts, served by
  // artifactResponse below, not this endpoint. The vs-main hash diff below is
  // for cold-start builds and pre-change bundles that never got a diff.json written.
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
    if (mainSha !== "unknown") diffCache.set(key, diff);
  }
  return json(diff, 200, headers);
}

const isIdentityFile = (name: string) => (IDENTITY_FILES as readonly string[]).includes(name);

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
  // identity*.json is written after the bundle is ready. While it is being
  // made the answer is "not yet", which the reader retries; a 404 is final.
  if (!res && isIdentityFile(name) && isRefining(sha)) return json({ status: "pending" }, 202, { ...headers, "Retry-After": "2" });
  if (!res) return json({ error: "not-found" }, 404, headers);
  touch(sha);
  return res;
}

// GET /api/preview/mine?shas=<comma-separated 40-hex>&at=<epoch ms, aligned> —
// the /preview index's "my recent previews" list. What it collects, and what a
// visitor is allowed to see of it, lives in mine.ts; this is only the HTTP shell.
// Session-scoped, so PRIVATE_HEADERS (no allow-origin, no-store): never
// cacheable by a shared proxy.
async function minePreviews(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const local = parseLocalOpens(url.searchParams.get("shas"), url.searchParams.get("at"));
  const session = await getSessionUser(req).catch(() => null);
  if (local.length === 0 && !session) return json([], 200, PRIVATE_HEADERS);
  if (session && mineRateLimited(session.user.id)) {
    // 429 rather than an empty 200: the client must be able to tell "nothing to
    // show" from "ask again", and it leaves the list it already has on screen.
    return json({ error: "rate-limited" }, 429, { ...PRIVATE_HEADERS, "retry-after": "2" });
  }
  const browserAt = new Map(local.map((l) => [l.sha, l.at]));
  return json(
    await visiblePreviews(req, session?.user.id ?? null, local.map((l) => l.sha), authorizePreviewAccess, browserAt),
    200,
    PRIVATE_HEADERS,
  );
}

// Local shorthand over the shared helper (http.ts): every preview response
// carries the CORS+noindex pair unless a private bundle swaps in PRIVATE_HEADERS,
// so the header argument is positional here rather than an options object.
function json(body: unknown, status: number, headers: Record<string, string> = CORS): Response {
  return httpJson(body, status, { headers });
}

/** Dispatch /api/preview/* . pathname includes the leading "/api/preview/". */
export function handlePreview(req: Request, server: Server<unknown>, pathname: string): Response | Promise<Response> {
  const rest = pathname.slice("/api/preview/".length);
  const segs = rest.split("/").filter(Boolean);
  // GET /api/preview/mine — the caller's OWN previews (private ones included,
  // each behind its repo's access check). There is deliberately no public
  // listing route: the one that existed ranked every preview anyone had opened,
  // and nothing consumed it once this one landed.
  if (segs.length === 1 && segs[0] === "mine") return minePreviews(req);
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
