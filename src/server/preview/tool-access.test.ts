// openPreviewForTool under each caller: anonymous MCP (canonical, built, public
// only, never builds) and signed-in chat (authorizes, may build, waits). Every
// I/O goes through the injected deps — no mock.module, which is process-global.
import { test, expect } from "bun:test";
import { openPreviewForTool, normalizePreviewId, waitForBuild, admitPrivate, type ToolAccessDeps } from "./tool-access.ts";
import type { PreviewMeta } from "./cache.ts";
import type { Resolved } from "./resolve.ts";
import type { PreviewEvent } from "./build.ts";
import type { GateOpened, GateDenied } from "./open-gate.ts";

const SHA = "b".repeat(40);
const meta = (over: Partial<PreviewMeta> = {}): PreviewMeta =>
  ({ sha: SHA, repo: "sky-ecosystem/next-gen-atlas", ref: "pull-7", kind: "pr", resolvedAt: "", docCount: 1, buildMs: 1, ...over }) as PreviewMeta;
const resolved = (over: Partial<Resolved> = {}): Resolved =>
  ({ repo: "sky-ecosystem/next-gen-atlas", sha: SHA, kind: "pr", ref: "pull-7", ...over }) as Resolved;
const PR = { number: 7, title: "t", author: "a", draft: false, updatedAt: "", headSha: SHA, baseRef: "main", url: "" };

function deps(over: Partial<ToolAccessDeps> = {}) {
  const calls = { build: 0, open: 0, authorize: [] as string[] };
  const d: Partial<ToolAccessDeps> = {
    openPrs: async () => [PR],
    open: async (_id, authorize) => {
      calls.open++;
      const r = resolved();
      if (r.private) {
        const decision = await authorize(r.repo);
        if (decision !== "ok") return { denied: decision } as GateDenied;
      }
      return { r, viaPrivateResolve: false } as GateOpened;
    },
    authorize: async (_u, repo) => {
      calls.authorize.push(repo);
      return "ok";
    },
    blocked: async () => false,
    takedown: async () => false,
    ready: () => true,
    meta: () => meta(),
    touch: () => {},
    limited: () => false,
    build: () => {
      calls.build++;
    },
    subscribe: () => () => {},
    ...over,
  };
  return { d, calls };
}

test("normalizePreviewId reads the ways a PR is written", () => {
  expect(normalizePreviewId(412)).toBe("pull-412");
  expect(normalizePreviewId("#412")).toBe("pull-412");
  expect(normalizePreviewId("PR 412")).toBe("pull-412");
  expect(normalizePreviewId("pull-412")).toBe("pull-412");
  expect(normalizePreviewId("https://github.com/sky-ecosystem/next-gen-atlas/pull/412")).toBe("pull-412");
  expect(normalizePreviewId("https://github.com/acme/mirror/pull/3/files")).toBe("acme:mirror:pull-3");
  expect(normalizePreviewId("acme:fix~x")).toBe("acme:fix~x");
  expect(normalizePreviewId("  ")).toBeNull();
});

test("MCP: a built, public, open canonical PR is ready", async () => {
  const { d } = deps();
  const o = await openPreviewForTool(7, { surface: "mcp" }, {}, d);
  expect(o).toMatchObject({ status: "ready", sha: SHA, id: "pull-7" });
});

test("MCP: never builds — an unbuilt PR is not-built", async () => {
  const { d, calls } = deps({ ready: () => false });
  expect((await openPreviewForTool(7, { surface: "mcp" }, {}, d)).status).toBe("not-built");
  expect(calls.build).toBe(0);
  expect(calls.open).toBe(0);
});

test("MCP: only canonical PRs — a fork, branch or sha id is not-found and never resolved", async () => {
  const { d, calls } = deps();
  for (const id of ["acme:repo:pull-1", "acme:branch", "main", SHA]) {
    expect((await openPreviewForTool(id, { surface: "mcp" }, {}, d)).status).toBe("not-found");
  }
  expect(calls.open).toBe(0);
});

test("MCP: a PR that is not open, a blocked sha, a private or unreadable meta are all not-found", async () => {
  expect((await openPreviewForTool(8, { surface: "mcp" }, {}, deps().d)).status).toBe("not-found");
  expect((await openPreviewForTool(7, { surface: "mcp" }, {}, deps({ blocked: async () => true }).d)).status).toBe("not-found");
  expect((await openPreviewForTool(7, { surface: "mcp" }, {}, deps({ meta: () => meta({ private: true }) }).d)).status).toBe("not-found");
  expect((await openPreviewForTool(7, { surface: "mcp" }, {}, deps({ meta: () => null }).d)).status).toBe("not-found");
});

test("MCP: an unanswered open-PR list is unavailable, not not-found", async () => {
  const { d } = deps({ openPrs: async () => null });
  expect((await openPreviewForTool(7, { surface: "mcp" }, {}, d)).status).toBe("unavailable");
});

test("no context is the anonymous MCP caller", async () => {
  const { d, calls } = deps({ ready: () => false });
  expect((await openPreviewForTool(7, undefined, {}, d)).status).toBe("not-built");
  expect(calls.build).toBe(0);
});

test("chat: a forbidden private repo reads exactly like a missing one", async () => {
  const privateOpen: ToolAccessDeps["open"] = async (_id, authorize) => {
    const decision = await authorize("acme/secret");
    return decision === "ok" ? { r: resolved({ private: true, repo: "acme/secret" }), viaPrivateResolve: true } : { denied: decision };
  };
  const forbidden = deps({ open: privateOpen, authorize: async () => "forbidden" }).d;
  const missing = deps({ open: async () => ({ denied: "not-found" }) }).d;
  const a = await openPreviewForTool("acme:secret:pull-1", { surface: "chat", userId: "u1" }, {}, forbidden);
  const b = await openPreviewForTool("acme:secret:pull-1", { surface: "chat", userId: "u1" }, {}, missing);
  expect(a).toEqual(b);
  expect(a.status).toBe("not-found");
});

test("chat: no signed-in user cannot open a private repo", async () => {
  const seen: string[] = [];
  const open: ToolAccessDeps["open"] = async (_id, authorize) => {
    const decision = await authorize("acme/secret");
    seen.push(decision);
    return { denied: decision as "login-required" };
  };
  const { d, calls } = deps({ open });
  expect((await openPreviewForTool("acme:secret:main", { surface: "chat" }, {}, d)).status).toBe("not-found");
  expect(seen).toEqual(["login-required"]);
  expect(calls.authorize).toEqual([]);
});

test("chat: an unavailable access check is reported as unavailable, not not-found", async () => {
  const { d } = deps({ open: async () => ({ denied: "unavailable" }) });
  expect((await openPreviewForTool("x:y:main", { surface: "chat", userId: "u" }, {}, d)).status).toBe("unavailable");
});

test("chat: builds a missing bundle and returns it once the build is ready", async () => {
  let built = false;
  const { d, calls } = deps({
    ready: () => built,
    subscribe: (_sha, send) => {
      built = true;
      queueMicrotask(() => send({ phase: "ready", sha: SHA }));
      return () => {};
    },
  });
  const o = await openPreviewForTool(7, { surface: "chat", userId: "u" }, { waitMs: 1000 }, d);
  expect(calls.build).toBe(1);
  expect(o.status).toBe("ready");
});

test("chat: a build still running when the wait ends is building; a failed one is failed", async () => {
  const running = deps({ ready: () => false, subscribe: () => () => {} }).d;
  expect((await openPreviewForTool(7, { surface: "chat", userId: "u" }, { waitMs: 10 }, running)).status).toBe("building");
  const failing = deps({
    ready: () => false,
    subscribe: (_s, send) => {
      send({ phase: "failed", code: "cap-exceeded" });
      return () => {};
    },
  }).d;
  expect(await openPreviewForTool(7, { surface: "chat", userId: "u" }, { waitMs: 1000 }, failing)).toMatchObject({ status: "failed", code: "cap-exceeded" });
});

test("chat: the build path is rate limited per user; a ready bundle is not", async () => {
  const limitedKeys: string[] = [];
  const limited = (k: string) => {
    limitedKeys.push(k);
    return true;
  };
  expect((await openPreviewForTool(7, { surface: "chat", userId: "u9" }, {}, deps({ limited }).d)).status).toBe("ready");
  expect(limitedKeys).toEqual([]);
  const { d, calls } = deps({ limited, ready: () => false });
  expect((await openPreviewForTool(7, { surface: "chat", userId: "u9" }, {}, d)).status).toBe("rate-limited");
  expect(limitedKeys).toEqual(["user:u9"]);
  expect(calls.build).toBe(0);
});

test("chat: a private bundle behind a resolution that did not say private is still authorized", async () => {
  const privateMeta = () => meta({ private: true, repo: "acme/secret" });
  const denied = deps({ meta: privateMeta, authorize: async () => "forbidden" }).d;
  expect((await openPreviewForTool(7, { surface: "chat", userId: "u" }, {}, denied)).status).toBe("not-found");
  const { d, calls } = deps({ meta: privateMeta });
  expect((await openPreviewForTool(7, { surface: "chat", userId: "u" }, {}, d)).status).toBe("ready");
  expect(calls.authorize).toEqual(["acme/secret"]);
  const outage = deps({ meta: privateMeta, authorize: async () => "unavailable" }).d;
  expect((await openPreviewForTool(7, { surface: "chat", userId: "u" }, {}, outage)).status).toBe("unavailable");
});

test("chat: a taken-down sha is not-found", async () => {
  const { d } = deps({ takedown: async () => true });
  expect((await openPreviewForTool(7, { surface: "chat", userId: "u" }, {}, d)).status).toBe("not-found");
});

test("waitForBuild unsubscribes on every outcome and honours abort", async () => {
  let unsubs = 0;
  const sub = (fire: PreviewEvent | null) => (_sha: string, send: (ev: PreviewEvent) => void) => {
    if (fire) send(fire);
    return () => {
      unsubs++;
    };
  };
  expect(await waitForBuild(SHA, 1000, undefined, sub({ phase: "ready", sha: SHA }))).toMatchObject({ phase: "ready" });
  expect(await waitForBuild(SHA, 5, undefined, sub(null))).toBeNull();
  const ac = new AbortController();
  const p = waitForBuild(SHA, 10_000, ac.signal, sub(null));
  ac.abort();
  expect(await p).toBeNull();
  expect(unsubs).toBe(3);
});

test("admitPrivate: public passes; private needs a chat callback that does not throw", async () => {
  expect(await admitPrivate({ surface: "mcp" }, meta())).toBe(true);
  expect(await admitPrivate({ surface: "mcp" }, meta({ private: true }))).toBe(false);
  expect(await admitPrivate({ surface: "chat", userId: "u" }, meta({ private: true }))).toBe(false);
  const seen: string[] = [];
  const ok = { surface: "chat" as const, userId: "u", onPrivateAccess: async (r: string) => void seen.push(r) };
  expect(await admitPrivate(ok, meta({ private: true, repo: "acme/secret" }))).toBe(true);
  expect(seen).toEqual(["acme/secret"]);
  const boom = { surface: "chat" as const, userId: "u", onPrivateAccess: async () => Promise.reject(new Error("db down")) };
  expect(await admitPrivate(boom, meta({ private: true }))).toBe(false);
});
