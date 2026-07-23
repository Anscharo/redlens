// Test json() and isStringArray() helpers. Run under `bun test`.
import { describe, test, expect } from "bun:test";
import { json, isStringArray } from "./http.ts";

describe("json()", () => {
  test("default args: status 200, no cookies, JSON body", async () => {
    const body = { message: "hello", count: 42 };
    const res = json(body);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual(body);
  });

  test("custom status code", async () => {
    const res = json({ error: "not found" }, 404);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  test("single cookie string", async () => {
    const cookie = "session=abc123; Path=/; HttpOnly";
    const res = json({ data: "test" }, 200, cookie);

    const setCookieValue = res.headers.get("set-cookie");
    expect(setCookieValue).toBe(cookie);
  });

  test("array of multiple cookies", async () => {
    const cookies = [
      "session=abc123; Path=/; HttpOnly",
      "token=xyz789; Path=/; Secure",
      "refresh=def456; Path=/",
    ];
    const res = json({ data: "test" }, 200, cookies);

    // Collect all set-cookie headers
    const setCookies: string[] = [];
    res.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") {
        setCookies.push(value);
      }
    });

    expect(setCookies).toHaveLength(3);
    expect(setCookies).toContain(cookies[0]);
    expect(setCookies).toContain(cookies[1]);
    expect(setCookies).toContain(cookies[2]);
  });

  test("empty cookies array results in no set-cookie header", async () => {
    const res = json({ data: "test" }, 200, []);

    let setCookieCount = 0;
    res.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") {
        setCookieCount++;
      }
    });

    expect(setCookieCount).toBe(0);
  });

  test("JSON body is properly stringified", async () => {
    const body = { nested: { array: [1, 2, 3], bool: true, nil: null } };
    const res = json(body);

    expect(await res.json()).toEqual(body);
  });

  test("primitive values are JSON-stringified", async () => {
    expect(await json("text").json()).toBe("text");
    expect(await json(42).json()).toBe(42);
    expect(await json(true).json()).toBe(true);
    expect(await json(null).json()).toBeNull();
  });
});

describe("isStringArray()", () => {
  test("empty array returns true", () => {
    expect(isStringArray([])).toBe(true);
  });

  test("array of strings returns true", () => {
    expect(isStringArray(["a", "b", "c"])).toBe(true);
    expect(isStringArray([""])).toBe(true);
    expect(isStringArray(["single"])).toBe(true);
  });

  test("array with mixed types returns false", () => {
    expect(isStringArray(["a", 1])).toBe(false);
    expect(isStringArray([1, "b"])).toBe(false);
    expect(isStringArray(["a", null])).toBe(false);
    expect(isStringArray(["a", undefined])).toBe(false);
    expect(isStringArray(["a", { key: "value" }])).toBe(false);
  });

  test("non-array values return false", () => {
    expect(isStringArray("not an array")).toBe(false);
    expect(isStringArray(123)).toBe(false);
    expect(isStringArray(true)).toBe(false);
  });

  test("null and undefined return false", () => {
    expect(isStringArray(null)).toBe(false);
    expect(isStringArray(undefined)).toBe(false);
  });

  test("object returns false", () => {
    expect(isStringArray({})).toBe(false);
    expect(isStringArray({ 0: "a", 1: "b" })).toBe(false);
  });

  test("type guard narrows to string[]", () => {
    const value: unknown = ["a", "b"];
    if (isStringArray(value)) {
      // TypeScript should recognize value as string[]
      const str: string = value[0];
      expect(str).toBe("a");
    }
  });
});
