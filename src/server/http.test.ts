// Pure helper unit tests. Run under `bun test`.
import { test, expect } from "bun:test";
import { json, isStringArray } from "./http.ts";

test("json sets content-type and serializes the body", async () => {
  const res = json({ ok: true });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/json");
  expect(await res.json()).toEqual({ ok: true });
});

test("json accepts a custom status", () => {
  const res = json({ error: "nope" }, 404);
  expect(res.status).toBe(404);
});

test("json with no cookies sets no set-cookie header", () => {
  const res = json({});
  expect(res.headers.get("set-cookie")).toBeNull();
});

test("json accepts a single cookie string", () => {
  const res = json({}, 200, "a=1");
  expect(res.headers.get("set-cookie")).toBe("a=1");
});

test("json accepts an array of cookies, appending each", () => {
  const res = json({}, 200, ["a=1", "b=2"]);
  // Headers.append joins repeated set-cookie values with ", " when read via get()
  expect(res.headers.get("set-cookie")).toBe("a=1, b=2");
});

test("isStringArray is true for an array of strings, including empty", () => {
  expect(isStringArray([])).toBe(true);
  expect(isStringArray(["a", "b"])).toBe(true);
});

test("isStringArray is false for non-arrays and mixed-type arrays", () => {
  expect(isStringArray("a")).toBe(false);
  expect(isStringArray(null)).toBe(false);
  expect(isStringArray(undefined)).toBe(false);
  expect(isStringArray(["a", 1])).toBe(false);
  expect(isStringArray([1, 2])).toBe(false);
});
