import { describe, expect, it } from "bun:test";
import { withResultBudget } from "../chat/output-budget.ts";
import { rrfFuse } from "../../lib/searchSemantic.ts";
import { fitWithExtra, PAGE_HINT, pageOf, poolSize } from "./result-page.ts";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `doc-${i}`, snippet: "x".repeat(380) }));

describe("pageOf", () => {
  it("returns the window with no paging fields when nothing lies past it", () => {
    const page = pageOf(rows(5), { offset: 0, k: 10 }, (r) => r);
    expect(page.rows.map((r) => r.id)).toEqual(["doc-0", "doc-1", "doc-2", "doc-3", "doc-4"]);
    expect(page.fields).toEqual({});
  });

  it("points at the next page when k, not the budget, ended this one", () => {
    const page = pageOf(rows(30), { offset: 10, k: 10 }, (r) => r);
    expect(page.rows[0].id).toBe("doc-10");
    expect(page.fields).toEqual({ next_offset: 20 });
  });

  it("drops whole rows at the budget and says the budget ended the page", () => {
    const page = withResultBudget(30_000, () => pageOf(rows(200), { offset: 0, k: 200 }, (r) => r));
    expect(page.rows.length).toBeGreaterThan(50);
    expect(page.rows.length).toBeLessThan(200);
    expect(JSON.stringify(page.rows).length).toBeLessThanOrEqual(30_000);
    expect(page.fields).toEqual({ next_offset: page.rows.length, truncated: true, hint: PAGE_HINT });
  });

  it("builds rows only for the window", () => {
    let built = 0;
    pageOf(rows(100), { offset: 20, k: 5 }, (r) => (built++, r));
    expect(built).toBe(5);
  });

  it("says so when offset is past the end of the ranking", () => {
    const page = pageOf(rows(3), { offset: 10, k: 10 }, (r) => r);
    expect(page.rows).toEqual([]);
    expect(page.fields).toEqual({ hint: "offset 10 is past the end of this ranking, which holds 3 rows at this k." });
  });

  it("tells a ranking cut at its pool from one that ran out of matches", () => {
    const cut = pageOf(rows(40), { offset: 30, k: 10 }, (r) => r, { poolCut: true });
    expect(cut.fields.ranking_cut).toBe(true);
    expect(cut.fields.hint).toContain("larger k");
    expect(cut.fields).not.toHaveProperty("next_offset");
    const widest = pageOf(rows(5), { offset: 0, k: 200 }, (r) => r, { poolCut: true });
    expect(widest.fields.hint).toContain("narrow with a type or filter");
    expect(pageOf(rows(40), { offset: 30, k: 10 }, (r) => r).fields).toEqual({});
  });

  it("returns what extra derived from the kept rows", () => {
    const page = pageOf(rows(3), { offset: 0, k: 10 }, (r) => r, { extra: (kept) => kept.length });
    expect(page.extra).toBe(3);
  });
});

describe("fitWithExtra", () => {
  it("leaves room for what the envelope derives from the kept rows", () => {
    const all = rows(100);
    const extra = (kept: unknown[]) => ({ ancestors: "y".repeat(kept.length * 100) });
    const fit = withResultBudget(30_000, () => fitWithExtra(all, extra));
    expect(fit.truncated).toBe(true);
    expect(fit.extra).toEqual(extra(fit.kept));
    expect(JSON.stringify(fit.kept).length + JSON.stringify(fit.extra).length).toBeLessThanOrEqual(30_000);
  });
});

describe("poolSize", () => {
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
});

describe("paging a fused ranking", () => {
  // Two legs that disagree, fused the way search.ts does: each leg fetched to
  // poolSize, then ranked by RRF score. The semantic leg reverses the first 100,
  // so d30 is lexical rank 30 and semantic rank 69: inside one pool of 40 and
  // outside the other, the case where a pool that grows with offset re-ranks it.
  const ids = Array.from({ length: 300 }, (_, i) => `d${i}`);
  const lexical = ids;
  const semantic = [...ids.slice(0, 100).reverse(), ...ids.slice(100)];
  const fused = (offset: number, k: number) => {
    const pool = poolSize(offset, k, false);
    const scores = rrfFuse([lexical.slice(0, pool), semantic.slice(0, pool)]);
    return [...scores.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([id]) => id);
  };

  it("reads one ranking across pages: no row repeats and none is skipped", () => {
    for (const k of [10, 200]) {
      const page = (offset: number) => pageOf(fused(offset, k), { offset, k }, (id) => ({ id, pad: "x".repeat(30) }));
      const first = k === 200 ? withResultBudget(4_000, () => page(0)) : page(0);
      const next = first.fields.next_offset!;
      const second = k === 200 ? withResultBudget(4_000, () => page(next)) : page(next);
      const read = [...first.rows, ...second.rows].map((r) => r.id);
      expect(new Set(read).size).toBe(read.length);
      expect(read).toEqual(fused(0, k).slice(0, read.length));
    }
  });
});

