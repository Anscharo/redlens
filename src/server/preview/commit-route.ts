// GET /api/preview/<sha>/commits?base=sky|repo&uuid=<uuid> — one document's
// commit-by-commit history on a preview's branch, as server-sent events.
//
// Every commit is sent, so a reader can show progress through the walk, but
// each carries only the asked-for document's rows: the walk is whole-branch and
// computed once, and a renumbering commit can touch every document there is.
// A finished walk replays from the bundle; a running one is joined; otherwise a
// walk starts, which is the only path the per-IP limit counts.

import { cachedCommitEvents } from "./commit-cache.ts";
import { startCommitWalk } from "./commit-history.ts";
import { planWalk } from "./commit-plan.ts";
import { isTerminal, joinWalk, walkKey, type CommitStreamEvent, type Send } from "./commit-stream.ts";
import type { CommitEntry } from "./commit-events.ts";
import type { CommitRecord } from "./commit-walk.ts";
import type { BaseKey, PreviewMeta } from "./cache.ts";
import { rateLimited } from "./rate-limit.ts";
import { gateSha } from "./sha-gate.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isBase = (b: string | null): b is BaseKey => b === "sky" || b === "repo";

/** The wire form of the stream: each commit carries only one document's rows. */
export type CommitWireEvent =
  | Exclude<CommitStreamEvent, { type: "commit" }>
  | { type: "commit"; index: number; commit: Omit<CommitRecord, "entries"> & { entries: CommitEntry[] } };

export function forDocument(ev: CommitStreamEvent, uuid: string): CommitWireEvent {
  if (ev.type !== "commit") return ev;
  const { entries, ...commit } = ev.commit;
  return { type: "commit", index: ev.index, commit: { ...commit, entries: entries[uuid] ?? [] } };
}

/** Feed `send` from the cache, a running walk, or a new one. Returns the unsubscribe. */
async function follow(sha: string, base: BaseKey, meta: PreviewMeta, ip: string, send: Send): Promise<() => void> {
  const cached = cachedCommitEvents(sha, base);
  if (cached) return (cached.forEach(send), () => {});
  const key = walkKey(sha, base);
  const joined = joinWalk(key, send);
  if (joined) return joined;
  if (rateLimited(ip)) return (send({ type: "error", reason: "rate-limited" }), () => {});
  const plan = await planWalk(sha, base, meta);
  if (!plan) return (send({ type: "error", reason: "unavailable" }), () => {});
  startCommitWalk(plan);
  return joinWalk(key, send) ?? (() => {});
}

/** One SSE frame per event; the last event ends the stream. A write that
 *  fails means the reader went away, which ends it too. */
function writer(controller: ReadableStreamDefaultController, isClosed: () => boolean, end: () => void) {
  const enc = new TextEncoder();
  return (ev: CommitWireEvent) => {
    if (isClosed()) return;
    try {
      controller.enqueue(enc.encode(`event: commits\ndata: ${JSON.stringify(ev)}\n\n`));
      if (!isTerminal(ev)) return;
      end();
      controller.close();
    } catch {
      end();
    }
  };
}

/** The stream shell: `run` feeds it and returns the unsubscribe; a `run` that
 *  rejects still ends the stream with an error event. */
export function sse(headers: Record<string, string>, run: (send: (ev: CommitWireEvent) => void) => Promise<() => void>): Response {
  // `closed` is shared with cancel: a reader gone before the walk is joined
  // must still release its subscription once the join resolves.
  let stop = () => {};
  let closed = false;
  const end = () => ((closed = true), stop());
  const stream = new ReadableStream({
    start(controller) {
      const send = writer(controller, () => closed, end);
      run(send).then(
        (u) => (closed ? u() : (stop = u)),
        () => send({ type: "error", reason: "failed" }),
      );
    },
    cancel: end,
  });
  return new Response(stream, { headers: streamHeaders(headers) });
}

/** The gate's headers replace the stream defaults: a private bundle's no-store must win. */
function streamHeaders(gate: Record<string, string>): Headers {
  const h = new Headers({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
  for (const [k, v] of Object.entries(gate)) h.set(k, v);
  return h;
}

export async function commitsResponse(req: Request, sha: string, ip: string): Promise<Response> {
  const gated = await gateSha(req, sha);
  if ("deny" in gated) return gated.deny;
  const q = new URL(req.url).searchParams;
  const base = q.get("base");
  const uuid = q.get("uuid") ?? "";
  if (!isBase(base) || !UUID_RE.test(uuid)) return Response.json({ error: "bad-request" }, { status: 400, headers: gated.headers });
  return sse(gated.headers, (send) => follow(sha, base, gated.meta, ip, (ev) => send(forDocument(ev, uuid))));
}
