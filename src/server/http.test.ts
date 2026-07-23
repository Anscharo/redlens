// Test the HTTP response helpers.
import { test, expect } from "bun:test";
import { json, isStringArray } from "./http.ts";

test("json() creates a response with correct content-type", () => {
  const res = json({ message: "ok" });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/json");
});

test("json() accepts custom status code", () => {
  const res = json({ error: "not found" }, 404);
  expect(res.status).toBe(404);
});

test("json() serializes the body correctly", async () => {
  const body = { id: 1, name: "test" };
  const res = json(body, 200);
  const text = await res.text();
  expect(JSON.parse(text)).toEqual(body);
});

test("json() can add a single cookie", () => {
  const res = json({ ok: true }, 200, "session=abc123");
  const cookies = res.headers.getSetCookie();
  expect(cookies).toContain("session=abc123");
});

test("json() can add multiple cookies via array", () => {
  const res = json({ ok: true }, 200, ["cookie1=a", "cookie2=b"]);
  const cookies = res.headers.getSetCookie();
  expect(cookies).toContain("cookie1=a");
  expect(cookies).toContain("cookie2=b");
});

test("json() handles empty cookie list", () => {
  const res = json({ ok: true }, 200, []);
  const cookies = res.headers.getSetCookie();
  expect(cookies.length).toBe(0);
});

test("json() handles undefined cookies", () => {
  const res = json({ ok: true }, 200);
  const cookies = res.headers.getSetCookie();
  expect(cookies.length).toBe(0);
});

test("isStringArray() accepts an array of strings", () => {
  expect(isStringArray(["a", "b", "c"])).toBe(true);
});

test("isStringArray() rejects non-array values", () => {
  expect(isStringArray("not an array")).toBe(false);
  expect(isStringArray(123)).toBe(false);
  expect(isStringArray(null)).toBe(false);
  expect(isStringArray(undefined)).toBe(false);
  expect(isStringArray({})).toBe(false);
});

test("isStringArray() rejects arrays with non-string elements", () => {
  expect(isStringArray([1, 2, 3])).toBe(false);
  expect(isStringArray(["a", 2, "c"])).toBe(false);
  expect(isStringArray(["a", null, "c"])).toBe(false);
  expect(isStringArray([{ key: "value" }])).toBe(false);
});

test("isStringArray() accepts empty array", () => {
  expect(isStringArray([])).toBe(true);
});
