import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

let inserted: unknown[] = [];
let rows: unknown[] = [{ id: "user-1" }];

mock.module("./db.ts", () => ({
  sql(_strings: TemplateStringsArray, ...values: unknown[]) {
    inserted = values;
    return Promise.resolve(rows);
  },
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
}));

const { upsertUser } = await import("./auth.ts");

afterAll(() => {
  mock.restore();
});

beforeEach(() => {
  inserted = [];
  rows = [{ id: "user-1" }];
});

describe("upsertUser", () => {
  it("upserts by provider identity and returns the session user", async () => {
    const user = await upsertUser(
      "github",
      "123",
      "ada@example.com",
      "Ada",
      "https://avatar.example/ada.png",
    );

    expect(user).toEqual({ id: "user-1", provider: "github" });
    expect(inserted).toEqual(["github", "123", "ada@example.com", "Ada", "https://avatar.example/ada.png"]);
  });

  it("passes nullable OAuth profile fields through to SQL", async () => {
    const user = await upsertUser("google", "sub-1", null, null, null);

    expect(user).toEqual({ id: "user-1", provider: "google" });
    expect(inserted).toEqual(["google", "sub-1", null, null, null]);
  });
});
