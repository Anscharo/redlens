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
import { json as httpJson, PREVIEW_CORS } from "../http.ts";
import { getIndexes } from "../retrieval/indexes.ts";
import { diffDocs } from "../atlas-refresh.ts";
import type { AtlasNode } from "../retrieval/indexes.ts";
import {
  CANONICAL_REPO,
  decodeId,
  gateError,
  makeGhClient,
  resolveRef,
  resolvePrivateBranch,
  type Resolved,
  type PendingPrivate,
} from "./resolve.ts";
import { getOrStartBuild, subscribeBuild, type PreviewEvent } from "./build.ts";
import { previewPaths, artifactPath, bundleReady, readMeta, writeMeta, touch, remove as removeBundle, type PreviewMeta } from "./cache.ts";
import { PREVIEW_STORE, serveBundleArtifact } from "../bundle-store.ts";
import { getPreviewRow, touchPreview, isBlockedSha, listPreviews } from "./db.ts";
import { authorizePreviewAccess } from "./access.ts";
import { appInstallUrl } from "./github-app.ts";

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
const gh = makeGhClient(config.githubToken);

// Resolution TTL cache (per raw id). Tracks the branch/PR tip so a pushed commit
// is picked up within ~60s without re-hitting GitHub on every request.
// Exported (with the cap) for the eviction regression test only — not otherwise
// consumed outside this module. Mirrors the diffCache/DIFF_CACHE_MAX pattern below.
type ResolveResult = Resolved | { error: "gate-rejected" | "not-found" | "not-a-fork" | "app-not-installed" } | PendingPrivate;
export const resolveCache = new Map<string, { at: number; v: ResolveResult }>();
const RESOLVE_TTL_MS = 60_000;
export const RESOLVE_CACHE_MAX = 1000; // FIFO cap — prevents indefinite growth under scanner traffic

// Per-IP fixed window on the build-triggering events endpoint. Exported for
// direct testing of the threshold + the size>5000 sweep, both otherwise only
// reachable by driving thousands of real HTTP calls through handlePreview.
export const ipHits = new Map<string, { n: number; reset: number }>();
const IP_WINDOW_MS = 10 * 60_000;
export const IP_LIMIT = 30;
export function rateLimited(ip: string): boolean {
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

// Exported for direct testing of the sha-rebuild branch (kind/prBase
// reconstruction from a previews row) without driving the full /events SSE
// flow + a real background build; every other caller is internal (drive()).
export async function resolveId(rawId: string): Promise<ResolveResult> {
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
          // Rebuild the ORIGINAL kind, not a hardcoded "branch": a canonical PR
          // row must come back as kind "pr" so build.ts's fork/trust screening
          // (keys on kind === "pr", not on the presence of `pr`) never gives it
          // fork treatment, and so pr-state.ts's `kind = 'pr'`-filtered UPDATE
          // still finds it. Everything else (fork/private PRs, plain branches)
          // stays "branch" exactly as resolveRef/resolvePrivateBranch produced it.
          kind: row.kind === "pr" ? "pr" : "branch",
          ref: row.ref,
          pr: row.pr_number
            ? { number: row.pr_number, title: row.pr_title ?? "", author: row.pr_author ?? "", state: (row.pr_state as any) ?? "open" }
            : undefined,
          // No sha here (see Resolved.prBase) — base-drift re-resolves the tip
          // rather than trusting a persisted one. The candidate resolver
          // (pr-diff.ts) keys on `prBase`, never `pr.number`, so this never
          // sends a private PR's number at canonical /pulls/N.
          prBase: row.pr_base_repo && row.pr_base_ref ? { repo: row.pr_base_repo, ref: row.pr_base_ref } : undefined,
          // Same round-trip for a fork branch's `repo` candidate: without it a
          // rebuilt bundle would redline against sky only and lose the switch.
          defaultBranch: row.default_branch ?? undefined,
          private: row.private,
        }
      : { error: "not-found" };
  } else if (gateError(parsed)) {
    // Not unit-tested directly: gateError (resolve.ts, out of scope here) is
    // hardcoded to always return null ("reserved for future grammar-level
    // gates"), so no input reaches this branch's body without changing that
    // file. bun's `/* v8 ignore */` comment did not suppress this line in this
    // file despite matching the syntax used elsewhere in the codebase — left
    // as a known, harmless gap rather than a directive that silently doesn't do
    // what it claims.
    v = { error: "gate-rejected" };
  } else {
    v = await resolveRef(parsed, gh);
  }
  // Don't cache app-not-installed: it flips to resolvable the instant the owner
  // installs the App on the repo, and a stale 60s error would make a fresh
  // install look like it didn't take — the user reloads and still sees "not
  // installed". Every other outcome is stable enough for the short TTL.
  if (!("error" in v) || v.error !== "app-not-installed") {
    resolveCache.set(rawId, { at: now, v });
    if (resolveCache.size > RESOLVE_CACHE_MAX) resolveCache.delete(resolveCache.keys().next().value!);
  }
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

// Returns the unsubscribe fn for the SSE stream (noop if it terminated synchronously).
async function drive(req: Request, rawId: string, ip: string, send: (ev: PreviewEvent) => void): Promise<() => void> {
  if (rateLimited(ip)) {
    send({ phase: "failed", code: "rate-limited", message: "Too many preview requests — try again shortly." });
    return () => {};
  }
  send({ phase: "resolving" });
  const resolved = await resolveId(rawId);
  if ("error" in resolved) {
    send({ phase: "failed", code: resolved.error, message: await failInstallMessage(resolved.error, repoOfId(rawId)) });
    return () => {};
  }
  // G3/G7: for a private repo, authorize BEFORE any sha-bearing event
  // (isBlockedSha/bundleReady/build) reaches an unauthorized caller — and, for a
  // deferred-private resolution, before the branch/PR→sha lookup itself, so an
  // unauthorized caller can never probe branch or PR existence. The resolve cache may
  // hold a private Resolved (incl. sha) or the PendingPrivate marker, but the
  // authorization decision is never cached; it's re-run per request against the
  // live session/collaborator state.
  let r: Resolved;
  if ("authRequired" in resolved) {
    const d = await authorizePreviewAccess(req, resolved.repo);
    if (d !== "ok") {
      send({ phase: "failed", code: d === "login-required" ? "auth-required" : d });
      return () => {};
    }
    const done = await resolvePrivateBranch(resolved.repo, resolved.ref);
    if ("error" in done) {
      send({ phase: "failed", code: done.error, message: await failInstallMessage(done.error, resolved.repo) });
      return () => {};
    }
    r = done;
  } else {
    r = resolved;
    if (r.private) {
      const d = await authorizePreviewAccess(req, r.repo);
      if (d !== "ok") {
        send({ phase: "failed", code: d === "login-required" ? "auth-required" : d });
        return () => {};
      }
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
    // A private PR first built without Pull requests:read has no prBase on
    // disk. After the owner grants it, this same id re-resolves with prBase —
    // rebuild so the redline switches onto the PR's own base instead of
    // serving the fallback bundle. Same-sha, so the quota (new-sha) gate
    // doesn't fire. A bundle that already recorded a prBase is left alone.
    // Same for a bundle that recorded NO base at all (a Contents-only private
    // PR built before the default branch stood in for the missing prBase, or
    // one whose default-branch lookup failed that day): once resolve has a
    // default branch, rebuild so the `repo` candidate exists. Never downgrades
    // — a bundle that holds a real prBase keeps it even if Pulls later 403s.
    const meta = readMeta(sha);
    if ((r.prBase && !meta?.prBase) || (r.defaultBranch && !meta?.defaultBranch && !meta?.prBase)) {
      getOrStartBuild(r);
      return subscribeBuild(sha, send);
    }
    // Banner-only: keep ACCESS in sync with the live install without a rebuild.
    // `authRequired` is the tell that r came from resolvePrivateBranch this
    // request (fresh repository_selection). A SHA/DB resolve must not run this
    // — it never carries grantTooBroad, and would clear a still-valid row.
    if (meta && "authRequired" in resolved) {
      const synced = syncBroadGrantMeta(meta, r);
      if (synced) writeMeta(sha, synced);
    }
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
