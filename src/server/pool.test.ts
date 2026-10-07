import { describe, expect, it } from "bun:test";
import { createSemaphore, mapPool } from "./pool.ts";

describe("createSemaphore", () => {
  it("hands slots out FIFO once released", async () => {
    const sem = createSemaphore(1);
    const order: number[] = [];
    await sem.acquire();
    const a = sem.acquire().then(() => order.push(1));
    const b = sem.acquire().then(() => order.push(2));
    await Promise.resolve();
    expect(order).toEqual([]);
    sem.release();
    await a;
    sem.release();
    await b;
    expect(order).toEqual([1, 2]);
  });

  it("reads a getter limit at acquire time", async () => {
    let cap = 1;
    const sem = createSemaphore(() => cap);
    await sem.acquire();
    cap = 2;
    await sem.acquire();
  });
});

describe("mapPool", () => {
  it("returns results in input order and respects the limit", async () => {
    let live = 0;
    let peak = 0;
    const out = await mapPool([30, 10, 20, 5], 2, async (ms, i) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, ms));
      live--;
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3]);
    expect(peak).toBe(2);
  });

  it("handles an empty list", async () => {
    expect(await mapPool([], 4, async () => 1)).toEqual([]);
  });
});
