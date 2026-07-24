// Harness for exercising the *worker-side* code of src/workers/*.worker.ts.
//
// A .worker.ts file runs inside a DedicatedWorkerGlobalScope: it reads `self.name`,
// registers `self.addEventListener("message", …)`, and replies with `self.postMessage`.
// jsdom/node give us neither a real worker global nor the message plumbing, so this
// installs a fake `self` before the module is imported, captures every outbound
// postMessage, and lets a test dispatch inbound messages exactly the way the main
// thread would. Combined with a stubbed global `fetch` (the workers fetch their
// artifacts through lib/verify), this runs the genuine worker code end-to-end —
// init, the message switch, and error paths — without a live Worker.
//
// Usage:
//   const h = installWorkerGlobal();              // BEFORE importing the worker
//   stubFetch({ "search-index.json": idxText });  // artifact routing
//   vi.resetModules();
//   await import("../workers/search.worker.ts");   // module init runs now
//   h.dispatch({ type: "preload", docs, addresses });
//   await h.waitFor((m) => m.type === "ready");

import { vi } from "vitest";

type Posted = Record<string, unknown> & { type: string };

export interface WorkerHarness {
  /** Every message the worker sent back to the main thread, in order. */
  posted: Posted[];
  /** Deliver a message INTO the worker (simulates main-thread postMessage). */
  dispatch: (data: unknown) => void;
  /** Resolve with the first posted message matching `pred` (waits across ticks).
   *  Pass `fromIndex` to ignore messages posted before that point — needed when
   *  the same message `type` is requested repeatedly and each response must be
   *  correlated to its own request. */
  waitFor: (pred: (m: Posted) => boolean, timeoutMs?: number, fromIndex?: number) => Promise<Posted>;
  /** All posted messages of a given `type`. */
  ofType: (type: string) => Posted[];
  /** Change self.name (data-source base) — call before importing the worker. */
  setName: (name: string) => void;
  /** Remove the fake self from globalThis. */
  restore: () => void;
}

const REAL_SELF = Object.getOwnPropertyDescriptor(globalThis, "self");

export function installWorkerGlobal(name = ""): WorkerHarness {
  const posted: Posted[] = [];
  let messageHandler: ((e: { data: unknown }) => void) | null = null;

  const fakeSelf = {
    name,
    postMessage: (msg: Posted) => {
      posted.push(msg);
    },
    addEventListener: (type: string, cb: (e: { data: unknown }) => void) => {
      if (type === "message") messageHandler = cb;
    },
    removeEventListener: () => {},
  };

  Object.defineProperty(globalThis, "self", {
    value: fakeSelf,
    configurable: true,
    writable: true,
  });

  return {
    posted,
    dispatch: (data) => {
      if (!messageHandler) throw new Error("worker has not registered a message listener yet");
      messageHandler({ data });
    },
    ofType: (type) => posted.filter((m) => m.type === type),
    setName: (n) => {
      fakeSelf.name = n;
    },
    waitFor: (pred, timeoutMs = 2000, fromIndex = 0) =>
      new Promise<Posted>((resolve, reject) => {
        const start = Date.now();
        const tick = () => {
          const hit = posted.slice(fromIndex).find(pred);
          if (hit) return resolve(hit);
          if (Date.now() - start > timeoutMs) {
            return reject(
              new Error(
                `waitFor timed out after ${timeoutMs}ms; posted: ${JSON.stringify(
                  posted.map((m) => m.type),
                )}`,
              ),
            );
          }
          setTimeout(tick, 0);
        };
        tick();
      }),
    restore: () => {
      if (REAL_SELF) Object.defineProperty(globalThis, "self", REAL_SELF);
      else delete (globalThis as Record<string, unknown>).self;
    },
  };
}

// --- fetch stubbing ---------------------------------------------------------

export interface StubFetchOptions {
  /** Force these artifact suffixes to reject with the given HTTP status. */
  fail?: Record<string, number>;
  /** Record of every URL fetch was called with (for base-path assertions). */
  calls?: string[];
}

/**
 * Route the workers' artifact fetches. Keys are matched by URL suffix
 * (e.g. "search-index.json", "docs-shallow.json", "relations.json").
 * A string value is served as-is; anything else is JSON.stringify'd.
 */
export function stubFetch(
  artifacts: Record<string, unknown>,
  opts: StubFetchOptions = {},
): { calls: string[] } {
  const calls = opts.calls ?? [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = String(url);
      calls.push(u);
      for (const [suffix, status] of Object.entries(opts.fail ?? {})) {
        if (u.endsWith(suffix)) return new Response("fail", { status });
      }
      for (const [suffix, body] of Object.entries(artifacts)) {
        if (u.endsWith(suffix)) {
          const text = typeof body === "string" ? body : JSON.stringify(body);
          return new Response(text, { status: 200 });
        }
      }
      return new Response("not found", { status: 404 });
    }),
  );
  return { calls };
}
