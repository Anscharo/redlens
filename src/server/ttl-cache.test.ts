import { expect, spyOn, test } from "bun:test";
import { createCache } from "./ttl-cache.ts";


test("FIFO: evicts the oldest insert once over max; get does not reorder", () => {
  const c = createCache<number>({ max: 2 });
  c.set("a", 1);
  c.set("b", 2);
  expect(c.get("a")).toBe(1);
  c.set("c", 3);
  expect(c.has("a")).toBe(false);
  expect(c.has("b")).toBe(true);
  expect(c.has("c")).toBe(true);
  expect(c.size).toBe(2);
});

test("FIFO: re-setting a present key keeps its position and never evicts", () => {
  const c = createCache<number>({ max: 2 });
  c.set("a", 1);
  c.set("b", 2);
  c.set("a", 10);
  expect(c.size).toBe(2);
  c.set("c", 3);
  expect(c.has("a")).toBe(false);
  expect(c.get("b")).toBe(2);
});

test("lru: a hit moves the entry to the recent end", () => {
  const c = createCache<number>({ max: 2, lru: true });
  c.set("a", 1);
  c.set("b", 2);
  expect(c.get("a")).toBe(1);
  c.set("c", 3);
  expect(c.has("b")).toBe(false);
  expect(c.get("a")).toBe(1);
  expect(c.get("c")).toBe(3);
});

test("max may be a getter, re-read on every insert", () => {
  let cap = 3;
  const c = createCache<number>({ max: () => cap });
  for (const k of ["a", "b", "c"]) c.set(k, 1);
  expect(c.size).toBe(3);
  cap = 1;
  c.set("d", 1);
  expect(c.size).toBe(1);
  expect(c.has("d")).toBe(true);
});

test("ttl: stale entries read as absent and are dropped by the read", () => {
  let now = 1_000;
  const spy = spyOn(Date, "now").mockImplementation(() => now);
  try {
    const c = createCache<string>({ max: 10, ttlMs: 100 });
    c.set("k", "v");
    now = 1_099;
    expect(c.get("k")).toBe("v");
    now = 1_100;
    expect(c.has("k")).toBe(true);
    expect(c.get("k")).toBeUndefined();
    expect(c.has("k")).toBe(false);
    expect(c.size).toBe(0);
  } finally {
    spy.mockRestore();
  }
});

test("ttl: set(at) stamps the entry from the given time", () => {
  let now = 5_000;
  const spy = spyOn(Date, "now").mockImplementation(() => now);
  try {
    const c = createCache<string>({ max: 10, ttlMs: 100 });
    c.set("k", "v", 4_950);
    now = 5_049;
    expect(c.get("k")).toBe("v");
    now = 5_050;
    expect(c.get("k")).toBeUndefined();
  } finally {
    spy.mockRestore();
  }
});

test("ttl with lru: a hit bumps recency but does not extend the TTL", () => {
  let now = 0;
  const spy = spyOn(Date, "now").mockImplementation(() => now);
  try {
    const c = createCache<number>({ max: 10, ttlMs: 100, lru: true });
    c.set("k", 1);
    now = 60;
    expect(c.get("k")).toBe(1);
    now = 100;
    expect(c.get("k")).toBeUndefined();
  } finally {
    spy.mockRestore();
  }
});

test("delete and clear", () => {
  const c = createCache<number>({ max: 5 });
  c.set("a", 1);
  c.set("b", 2);
  c.delete("a");
  expect(c.size).toBe(1);
  c.clear();
  expect(c.size).toBe(0);
  expect(c.get("b")).toBeUndefined();
});
