import { describe, expect, it } from "bun:test";
import { MAX_RESULT_CHARS } from "../chat/output-budget.ts";
import { fitWithExtra, PAGE_HINT, pageOf, poolSize, resultChars } from "./result-page.ts";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `doc-${i}`, snippet: "x".repeat(380) }));

describe("pageOf", () => {
  it("returns the window with no paging fields when nothing lies past it", () => {
    const page = pageOf(rows(5), { offset: 0, k: 10 }, MAX_RESULT_CHARS, (r) => r);
    expect(page.rows.map((r) => r.id)).toEqual(["doc-0", "doc-1", "doc-2", "doc-3", "doc-4"]);
    expect(page.fields).toEqual({});
  });

  it("points at the next page when k, not the budget, ended this one", () => {
    const page = pageOf(rows(30), { offset: 10, k: 10 }, MAX_RESULT_CHARS, (r) => r);
    expect(page.rows[0].id).toBe("doc-10");
    expect(page.fields).toEqual({ next_offset: 20 });
  });

  it("drops whole rows at the budget and says the budget ended the page", () => {
    const page = pageOf(rows(200), { offset: 0, k: 200 }, 30_000, (r) => r);
    expect(page.rows.length).toBeGreaterThan(50);
    expect(page.rows.length).toBeLessThan(200);
    expect(JSON.stringify(page.rows).length).toBeLessThanOrEqual(30_000);
    expect(page.fields).toEqual({ next_offset: page.rows.length, truncated: true, hint: PAGE_HINT });
  });

  it("builds rows only for the window", () => {
    let built = 0;
    pageOf(rows(100), { offset: 20, k: 5 }, MAX_RESULT_CHARS, (r) => (built++, r));
    expect(built).toBe(5);
  });

  it("returns nothing and no paging fields past the end", () => {
    expect(pageOf(rows(3), { offset: 10, k: 10 }, MAX_RESULT_CHARS, (r) => r)).toEqual({ rows: [], fields: {} });
  });
});

describe("fitWithExtra", () => {
  it("leaves room for what the envelope derives from the kept rows", () => {
    const all = rows(100);
    const extra = (kept: unknown[]) => ({ ancestors: "y".repeat(kept.length * 100) });
    const { kept, truncated } = fitWithExtra(all, 30_000, extra);
    expect(truncated).toBe(true);
    expect(JSON.stringify(kept).length + JSON.stringify(extra(kept)).length).toBeLessThanOrEqual(30_000);
  });
});

describe("poolSize and resultChars", () => {
  it("fetches an exact ranking one past the window so a full page knows more exist", () => {
    expect(poolSize(0, 10, true)).toBe(11);
    expect(poolSize(30, 10, true)).toBe(41);
  });

  it("fetches a fused ranking by k alone, so every page of one k reads the same ranking", () => {
    expect(poolSize(0, 10, false)).toBe(40);
    expect(poolSize(30, 10, false)).toBe(40);
    expect(poolSize(0, 50, false)).toBe(200);
    expect(poolSize(78, 200, false)).toBe(800);
  });

  it("uses the chat cut when the transport passes one, else the MCP budget", () => {
    expect(resultChars(undefined)).toBe(MAX_RESULT_CHARS);
    expect(resultChars({ surface: "mcp" })).toBe(MAX_RESULT_CHARS);
    expect(resultChars({ surface: "chat", resultChars: 30_000 })).toBe(30_000);
  });
});
