// sweepPrStates: PR-state sweep. The sql param is injected directly (a fake
// SqlTag), so no DB mocking needed. GitHub is reached through resolve.ts's
// makeGhClient, which calls the global fetch — stubbed here the same way
// open-prs.test.ts drives handler.ts's GitHub calls, restored in afterAll.
import { test, expect, afterAll } from "bun:test";
import { sweepPrStates } from "./pr-state.ts";

const realFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(byPr: Record<number, { status: number; json?: any }>) {
  // @ts-expect-error minimal fetch stub
  globalThis.fetch = (input: RequestInfo | URL) => {
    const m = String(input).match(/\/pulls\/(\d+)$/);
    const pr = m ? Number(m[1]) : -1;
    const entry = byPr[pr];
    if (!entry) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) } as Response);
    return Promise.resolve({
      ok: entry.status < 400,
      status: entry.status,
      json: () => Promise.resolve(entry.json ?? null),
    } as Response);
  };
}

function fakeSql(rows: { pr_number: number }[], updateResults: Record<number, { sha: string }[]>) {
  const calls: string[] = [];
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push(text);
    if (text.includes("SELECT DISTINCT pr_number")) return rows;
    if (text.includes("UPDATE previews SET pr_state")) {
      const prNumber = values[1] as number; // ${pr_number} is the second interpolation
      return updateResults[prNumber] ?? [];
    }
    return [];
  }) as any;
  return { sql, calls };
}

test("no preview rows → short-circuits without any GitHub calls", async () => {
  const { sql } = fakeSql([], {});
  let fetchCalled = false;
  // @ts-expect-error stub
  globalThis.fetch = () => {
    fetchCalled = true;
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) } as Response);
  };
  const result = await sweepPrStates(sql, "tok");
  expect(result).toEqual({ checked: 0, updated: 0 });
  expect(fetchCalled).toBe(false);
});

test("merged PR updates pr_state to merged and counts it", async () => {
  stubFetch({ 256: { status: 200, json: { merged_at: "2026-01-01T00:00:00Z", state: "closed" } } });
  const { sql } = fakeSql([{ pr_number: 256 }], { 256: [{ sha: "abc" }] });
  const result = await sweepPrStates(sql, "tok");
  expect(result).toEqual({ checked: 1, updated: 1 });
});

test("closed (not merged) PR maps to closed state", async () => {
  stubFetch({ 5: { status: 200, json: { merged_at: null, state: "closed" } } });
  let capturedState: unknown;
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("SELECT DISTINCT pr_number")) return [{ pr_number: 5 }];
    if (text.includes("UPDATE previews SET pr_state")) {
      capturedState = values[0];
      return [];
    }
    return [];
  }) as any;
  await sweepPrStates(sql, "tok");
  expect(capturedState).toBe("closed");
});

test("open PR maps to open state", async () => {
  stubFetch({ 9: { status: 200, json: { merged_at: null, state: "open" } } });
  let capturedState: unknown;
  const sql = (async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("SELECT DISTINCT pr_number")) return [{ pr_number: 9 }];
    if (text.includes("UPDATE previews SET pr_state")) {
      capturedState = values[0];
      return [];
    }
    return [];
  }) as any;
  await sweepPrStates(sql, "tok");
  expect(capturedState).toBe("open");
});

test("a GitHub failure for one PR is skipped (not counted, not thrown)", async () => {
  stubFetch({}); // no PR entries → 404 for everything
  const { sql } = fakeSql([{ pr_number: 1 }, { pr_number: 2 }], {});
  const result = await sweepPrStates(sql, "tok");
  expect(result).toEqual({ checked: 2, updated: 0 });
});

test("an UPDATE that changes nothing (state already current) doesn't count as updated", async () => {
  stubFetch({ 42: { status: 200, json: { merged_at: null, state: "open" } } });
  const { sql } = fakeSql([{ pr_number: 42 }], { 42: [] }); // RETURNING sha empty → no rows changed
  const result = await sweepPrStates(sql, "tok");
  expect(result).toEqual({ checked: 1, updated: 0 });
});

test("multiple PRs: mixed updated/unchanged/failed tallies correctly", async () => {
  stubFetch({
    1: { status: 200, json: { merged_at: "t", state: "closed" } }, // merged, updates
    2: { status: 200, json: { merged_at: null, state: "open" } }, // no change
    3: { status: 500 }, // fails
  });
  const { sql } = fakeSql([{ pr_number: 1 }, { pr_number: 2 }, { pr_number: 3 }], { 1: [{ sha: "s1" }], 2: [] });
  const result = await sweepPrStates(sql, "tok");
  expect(result).toEqual({ checked: 3, updated: 1 });
});

test("defaults token to process.env.GITHUB_TOKEN when omitted", async () => {
  stubFetch({});
  const { sql } = fakeSql([], {});
  await expect(sweepPrStates(sql)).resolves.toEqual({ checked: 0, updated: 0 });
});
