// Opening a preview for the chat/MCP preview tools — the non-SSE twin of
// handler.ts drive(), sharing its resolve → authorize → takedown steps through
// open-gate.ts.
//
//   MCP (anonymous): canonical `pull-N` only, open PRs only, and only a bundle
//   that is already built and public. It never starts a build.
//   Chat (signed in): any preview id. A private repo is authorized live against
//   the user's GitHub collaborator status (access.ts), and a missing bundle is
//   built under the existing trust/quota gates, waiting up to `waitMs`.
//
// Every "you may not see this" collapses into `not-found`, so neither surface
// can probe whether a private repo, branch or PR exists.

import { config } from "../config.ts";
import type { ToolCallContext } from "../chat/tools/tool-context.ts";
import { ANON_MCP_CTX } from "../chat/tools/tool-context.ts";
import { authorizeUserRepoAccess, type AccessDecision } from "./access.ts";
import { getOrStartBuild, subscribeBuild, type PreviewEvent, type PreviewErrorCode } from "./build.ts";
import { bundleReady, readMeta, touch, type PreviewMeta } from "./cache.ts";
import { isBlockedSha, touchPreview } from "./db.ts";
import { resolveAuthorized, takedownBlocked } from "./open-gate.ts";
import { fetchOpenPrs, type OpenPr } from "./open-prs.ts";
import { rateLimited } from "./rate-limit.ts";
import { CANONICAL_REPO, decodeId, type Resolved } from "./resolve.ts";

export type ToolOpen =
  | { status: "ready"; id: string; sha: string; meta: PreviewMeta }
  | { status: "building"; id: string; sha: string }
  | { status: "not-built"; id: string }
  | { status: "failed"; id: string; code: PreviewErrorCode; detail?: string }
  | { status: "not-found" | "unavailable" | "rate-limited"; id: string };

export interface ToolAccessDeps {
  openPrs: () => Promise<OpenPr[] | null>;
  open: typeof resolveAuthorized;
  authorize: (userId: string, repo: string) => Promise<AccessDecision>;
  blocked: (sha: string) => Promise<boolean>;
  takedown: (sha: string) => Promise<boolean>;
  ready: (sha: string) => boolean;
  meta: (sha: string) => PreviewMeta | null;
  touch: (sha: string) => void;
  limited: (key: string) => boolean;
  build: (r: Resolved) => void;
  subscribe: (sha: string, send: (ev: PreviewEvent) => void) => () => void;
}

const DEFAULT_DEPS: ToolAccessDeps = {
  openPrs: fetchOpenPrs,
  open: resolveAuthorized,
  authorize: authorizeUserRepoAccess,
  blocked: (sha) => isBlockedSha(sha).catch(() => false),
  takedown: takedownBlocked,
  ready: bundleReady,
  meta: readMeta,
  touch: (sha) => {
    touch(sha);
    void touchPreview(sha).catch(() => {});
  },
  limited: rateLimited,
  build: (r) => void getOrStartBuild(r),
  subscribe: subscribeBuild,
};

const PR_URL_RE = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/i;

/** What a model or user writes for a PR — a bare number, "#N", "PR N",
 *  "pull-N", a GitHub PR URL — as a preview id. Anything else passes through as a raw id
 *  (a sha, `owner:branch`, `owner:repo:pull-N`, a canonical branch). */
export function normalizePreviewId(arg: unknown): string | null {
  const raw = String(arg ?? "").trim();
  if (!raw) return null;
  const n = raw.match(/^(?:pr\s*)?#?\s*(\d+)$/i);
  if (n) return `pull-${n[1]}`;
  const u = raw.match(PR_URL_RE);
  if (u) {
    const repo = `${u[1]}/${u[2]}`;
    return repo.toLowerCase() === CANONICAL_REPO ? `pull-${u[3]}` : `${u[1]}:${u[2]}:pull-${u[3]}`;
  }
  return raw;
}

/** Waits for a build's terminal event, or null once `ms` pass or `signal` aborts.
 *  Always unsubscribes. */
export function waitForBuild(
  sha: string,
  ms: number,
  signal: AbortSignal | undefined,
  subscribe: ToolAccessDeps["subscribe"] = subscribeBuild,
): Promise<PreviewEvent | null> {
  return new Promise((resolve) => {
    let unsub = () => {};
    let settled = false;
    const finish = (ev: PreviewEvent | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      unsub();
      resolve(ev);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), ms);
    signal?.addEventListener("abort", onAbort);
    unsub = subscribe(sha, (ev) => {
      if (ev.phase === "ready" || ev.phase === "failed") finish(ev);
    });
    if (settled) unsub();
    if (signal?.aborted) finish(null);
  });
}

async function openForMcp(id: string, d: ToolAccessDeps): Promise<ToolOpen> {
  const parsed = decodeId(id);
  if (parsed?.kind !== "pr") return { status: "not-found", id };
  const prs = await d.openPrs();
  if (!prs) return { status: "unavailable", id };
  const pr = prs.find((p) => p.number === parsed.prNumber);
  if (!pr?.headSha) return { status: "not-found", id };
  const sha = pr.headSha.toLowerCase();
  if (await d.blocked(sha)) return { status: "not-found", id };
  if (!d.ready(sha)) return { status: "not-built", id };
  // An unreadable meta can never be shown to be public — same rule as gateSha.
  const meta = d.meta(sha);
  if (!meta || meta.private) return { status: "not-found", id };
  d.touch(sha);
  return { status: "ready", id, sha, meta };
}

async function openForChat(id: string, ctx: ToolCallContext, waitMs: number, d: ToolAccessDeps): Promise<ToolOpen> {
  const userId = ctx.userId;
  const opened = await d.open(id, (repo) => (userId ? d.authorize(userId, repo) : Promise.resolve("login-required")));
  if ("denied" in opened) return { status: opened.denied === "unavailable" ? "unavailable" : "not-found", id };
  const { r } = opened;
  if (await d.takedown(r.sha)) return { status: "not-found", id };
  if (d.ready(r.sha)) {
    const meta = d.meta(r.sha);
    if (!meta) return { status: "not-found", id };
    const access = await bundleAccess(meta, r, userId, d);
    if (access !== "ok") return { status: access, id };
    d.touch(r.sha);
    return { status: "ready", id, sha: r.sha, meta };
  }
  if (d.limited(`user:${userId ?? "anon"}`)) return { status: "rate-limited", id };
  d.build(r);
  const ev = await waitForBuild(r.sha, waitMs, ctx.signal, d.subscribe);
  if (ev?.phase === "failed") return { status: "failed", id, code: ev.code ?? "build-failed", ...(ev.message ? { detail: ev.message.slice(0, 600) } : {}) };
  // A build that finished between start and subscribe emits nothing; the disk says.
  const meta = d.ready(r.sha) ? d.meta(r.sha) : null;
  const access = meta ? await bundleAccess(meta, r, userId, d) : "ok";
  if (access !== "ok") return { status: access, id };
  return meta ? { status: "ready", id, sha: r.sha, meta } : { status: "building", id, sha: r.sha };
}

/** The bundle's own meta decides privacy, as gateSha does for the reader: a
 *  private bundle reached through a resolution that did not say private (a
 *  stale previews row) is authorized here before it is served. A denial reads
 *  as not-found; a check GitHub could not answer reads as unavailable. */
async function bundleAccess(
  meta: PreviewMeta,
  r: Resolved,
  userId: string | undefined,
  d: ToolAccessDeps,
): Promise<"ok" | "not-found" | "unavailable"> {
  if (!meta.private || r.private) return "ok";
  if (!userId) return "not-found";
  const decision = await d.authorize(userId, meta.repo);
  return decision === "ok" ? "ok" : decision === "unavailable" ? "unavailable" : "not-found";
}

/** Open the preview `rawId` names for a tool call, under `ctx`'s privileges. */
export function openPreviewForTool(
  rawId: unknown,
  ctx: ToolCallContext = ANON_MCP_CTX,
  opts: { waitMs?: number } = {},
  deps: Partial<ToolAccessDeps> = {},
): Promise<ToolOpen> {
  const id = normalizePreviewId(rawId);
  if (!id) return Promise.resolve({ status: "not-found", id: String(rawId ?? "") });
  const d = { ...DEFAULT_DEPS, ...deps };
  if (ctx.surface !== "chat") return openForMcp(id, d);
  return openForChat(id, ctx, opts.waitMs ?? config.chatPreviewBuildWaitMs, d);
}

/** Before a tool returns a private preview's content: the chat turn records it
 *  (and turns off content capture). Absent or throwing ⇒ the content is withheld. */
export async function admitPrivate(ctx: ToolCallContext, meta: PreviewMeta): Promise<boolean> {
  if (!meta.private) return true;
  if (ctx.surface !== "chat" || !ctx.onPrivateAccess) return false;
  try {
    await ctx.onPrivateAccess(meta.repo);
    return true;
  } catch {
    return false;
  }
}
