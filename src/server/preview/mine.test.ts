// preview/mine.ts — the /api/preview/mine data layer: sha-list parsing, the
// two-source union, and the disclosure filter. Mocks ../db.ts (the same factory
// shape as db.test.ts / handler.test.ts); access.ts is NOT module-mocked — its
// decision is injected through visibleToVisitor's `authorize` seam, so
// access.test.ts keeps linking the real module whatever order bun walks files in.
import { test, expect, mock, beforeEach, afterAll } from "bun:test";
import { toUuidArrayLiteral, fromUuidArray } from "../pg-array.ts";
import type { AccessDecision } from "./access.ts";

let queued: unknown[] = [];
let calls: string[] = [];
mock.module("../db.ts", () => ({
  sql(strings: TemplateStringsArray, ...values: unknown[]) {
    calls.push([...strings].join("?"));
    void values;
    const next = queued.shift();
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next ?? []);
  },
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
  // Real impls, never re-stubbed — see pg-array.ts; enforced by check:mocks.
  toUuidArrayLiteral,
  fromUuidArray,
}));

const { parseShaList, collectMineRows, visibleToVisitor, MINE_MAX_SHAS, MINE_MAX_PRIVATE } = await import("./mine.ts");
type MineRow = Awaited<ReturnType<typeof collectMineRows>>[number];

afterAll(() => mock.restore());
beforeEach(() => {
  queued = [];
  calls = [];
});

const SHA = (c: string) => c.repeat(40);
const req = new Request("http://x/api/preview/mine");
function row(over: Partial<MineRow> & { sha: string }): MineRow {
  return {
    repo: "blimpa/next-gen-atlas", ref: "main", kind: "branch",
    pr_number: null, pr_title: null, pr_author: null, pr_state: null,
    doc_count: 1, last_access: "2026-09-01T00:00:00Z", private: false, ...over,
  } as MineRow;
}
const ok = () => Promise.resolve("ok" as AccessDecision);

// --- parseShaList -------------------------------------------------------------

test("parseShaList keeps 40-hex shas, case-folded and deduped, and drops the rest", () => {
  expect(parseShaList(`${SHA("A")},not-a-sha,,${SHA("a")},${SHA("b")}`)).toEqual([SHA("a"), SHA("b")]);
  expect(parseShaList(null)).toEqual([]);
  expect(parseShaList("nope")).toEqual([]);
});

test("parseShaList caps the list, so one request's DB work stays bounded", () => {
  const many = Array.from({ length: MINE_MAX_SHAS + 20 }, (_, i) => i.toString(16).padStart(40, "0"));
  expect(parseShaList(many.join(",")).length).toBe(MINE_MAX_SHAS);
});

// --- collectMineRows ----------------------------------------------------------

test("collectMineRows queries only the sources it has: no user, no opens query", async () => {
  queued = [[row({ sha: SHA("a") })]];
  await collectMineRows(null, [SHA("a")]);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain("FROM previews");
});

test("collectMineRows queries only the sources it has: no shas, no sha query", async () => {
  queued = [[]];
  await collectMineRows("user-1", []);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain("FROM preview_opens o");
});

test("collectMineRows unions both sources, account rows first", async () => {
  const account = row({ sha: SHA("a"), preview_id: "pull-9", opened_at: "2026-09-20T00:00:00Z" });
  const browser = row({ sha: SHA("b") });
  queued = [[account], [browser]];
  expect(await collectMineRows("user-1", [SHA("b")])).toEqual([account, browser]);
});

test("collectMineRows keeps one source's failure from blanking the other", async () => {
  const browser = row({ sha: SHA("b") });
  queued = [new Error("opens query died"), [browser]];
  expect(await collectMineRows("user-1", [SHA("b")])).toEqual([browser]);

  calls = [];
  const account = row({ sha: SHA("a"), preview_id: "p", opened_at: "" });
  queued = [[account], new Error("sha query died")];
  expect(await collectMineRows("user-1", [SHA("b")])).toEqual([account]);
});

// --- visibleToVisitor ---------------------------------------------------------

test("public rows pass through untouched and cost no access check", async () => {
  const rows = [row({ sha: SHA("a") }), row({ sha: SHA("b") })];
  const authorize = mock(ok);
  expect(await visibleToVisitor(req, rows, authorize)).toEqual(rows);
  expect(authorize).not.toHaveBeenCalled();
});

test("a private row survives only on an ok decision", async () => {
  const priv = row({ sha: SHA("c"), repo: "acme/secret", private: true });
  for (const decision of ["ok", "forbidden", "login-required", "unavailable"] as AccessDecision[]) {
    const out = await visibleToVisitor(req, [priv], () => Promise.resolve(decision));
    expect(out).toEqual(decision === "ok" ? [priv] : []);
  }
  // A throw is a non-decision, so it drops the row too — never discloses on doubt.
  expect(await visibleToVisitor(req, [priv], () => Promise.reject(new Error("github down")))).toEqual([]);
});

test("input order is preserved when private rows are mixed in", async () => {
  const rows = [
    row({ sha: SHA("a") }),
    row({ sha: SHA("b"), repo: "acme/secret", private: true, opened_at: "2026-09-02T00:00:00Z", preview_id: "p1" }),
    row({ sha: SHA("c") }),
  ];
  expect((await visibleToVisitor(req, rows, ok)).map((r) => r.sha)).toEqual([SHA("a"), SHA("b"), SHA("c")]);
});

test("one permission check per private REPO, however many of its shas are listed", async () => {
  const rows = ["a", "b", "c"].map((c) =>
    row({ sha: SHA(c), repo: "acme/secret", private: true, preview_id: `p-${c}`, opened_at: "2026-09-02T00:00:00Z" }),
  );
  const authorize = mock(ok);
  expect(await visibleToVisitor(req, rows, authorize)).toHaveLength(3);
  expect(authorize).toHaveBeenCalledTimes(1); // every push makes a new sha; the grant is per repo
});

test("only the MINE_MAX_PRIVATE newest private previews are considered", async () => {
  // 9 private previews of distinct repos, oldest first — only the 6 newest may
  // be checked, and the response must be exactly those.
  const rows = Array.from({ length: 9 }, (_, i) =>
    row({
      sha: SHA(String(i)),
      repo: `acme/secret-${i}`,
      private: true,
      preview_id: `p-${i}`,
      opened_at: new Date(Date.UTC(2026, 8, i + 1)).toISOString(),
    }),
  );
  const authorize = mock(ok);
  const out = await visibleToVisitor(req, rows, authorize);
  expect(authorize).toHaveBeenCalledTimes(MINE_MAX_PRIVATE);
  expect(out.map((r) => ("preview_id" in r ? r.preview_id : r.sha))).toEqual(["p-3", "p-4", "p-5", "p-6", "p-7", "p-8"]);
});

test("recency comes from the visitor's own open, falling back to last_access", () => {
  const mine = row({ sha: SHA("a"), repo: "acme/one", private: true, preview_id: "mine", opened_at: "2026-09-25T00:00:00Z", last_access: "2020-01-01T00:00:00Z" });
  const other = row({ sha: SHA("b"), repo: "acme/two", private: true, last_access: "2026-09-24T00:00:00Z" });
  // Fill all but one slot with rows newer than both, so exactly one of these two
  // gets in. `mine` wins on the visitor's own open even though ANY visit made
  // `other`'s last_access look newer than mine's.
  const pad = Array.from({ length: MINE_MAX_PRIVATE - 1 }, (_, i) =>
    row({ sha: SHA(`x${i}`), repo: `acme/pad-${i}`, private: true, preview_id: `pad-${i}`, opened_at: "2026-09-26T00:00:00Z" }),
  );
  return visibleToVisitor(req, [...pad, other, mine], ok).then((out) => {
    expect(out.map((r) => r.sha)).toContain(SHA("a"));
    expect(out.map((r) => r.sha)).not.toContain(SHA("b"));
  });
});

test("the private access checks run concurrently, not one after another", async () => {
  let inFlight = 0;
  let peak = 0;
  const authorize = async () => {
    peak = Math.max(peak, ++inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return "ok" as AccessDecision;
  };
  const rows = ["a", "b", "c"].map((c) =>
    row({ sha: SHA(c), repo: `acme/secret-${c}`, private: true, preview_id: `p-${c}`, opened_at: "2026-09-02T00:00:00Z" }),
  );
  expect(await visibleToVisitor(req, rows, authorize)).toHaveLength(3);
  expect(peak).toBe(3); // serialized would peak at 1 and cost 3 round trips of latency
});
