import { describe, expect, it } from "bun:test";
import { isStringArray, json } from "./http.ts";

describe("json", () => {
  it("serializes JSON with the application content type", async () => {
    const res = json({ ok: true }, 201);

    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("appends every Set-Cookie header", () => {
    const res = json({ ok: true }, 200, ["a=1; Path=/", "b=2; Path=/"]);

    expect(res.headers.getAll("set-cookie")).toEqual(["a=1; Path=/", "b=2; Path=/"]);
  });
});

describe("isStringArray", () => {
  it("accepts arrays made entirely of strings", () => {
    expect(isStringArray([])).toBe(true);
    expect(isStringArray(["a", "b"])).toBe(true);
  });

  it("rejects non-arrays and mixed arrays", () => {
    expect(isStringArray("a")).toBe(false);
    expect(isStringArray(["a", 1])).toBe(false);
    expect(isStringArray(["a", null])).toBe(false);
  });
});
