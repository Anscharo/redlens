// Run under `bun test` (NOT vitest) — imports Bun SQL transitively.
import { describe, it, expect, mock, beforeEach } from "bun:test";

const VALID_UUID = "d0d77316-0b08-447c-b75a-ae7926b07019";
const VALID_UUID_2 = "f8225872-d517-40f1-a931-241b5d0cc07b";

describe("handleModCounts", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("maps rows to the client ModCount shape and normalises dates", async () => {
    mock.module("../db.ts", () => ({
      sql: {
        unsafe: () =>
          Promise.resolve([
            {
              doc_id: VALID_UUID,
              semantic_count: 3,
              last_semantic_at: new Date("2026-05-20T10:09:52-07:00"),
              content_count: 7,
            },
            {
              doc_id: VALID_UUID_2,
              semantic_count: 0,
              last_semantic_at: null,
              content_count: 2,
            },
          ]),
      },
    }));
    const { handleModCounts } = await import("./mod-counts.ts");
    const res = await handleModCounts();
    expect(res.status).toBe(200);
    const body = (await res.json()) as any[];
    expect(body).toEqual([
      { docId: VALID_UUID, count: 3, lastModified: "2026-05-20", contentCount: 7 },
      { docId: VALID_UUID_2, count: 0, lastModified: null, contentCount: 2 },
    ]);
  });

  it("normalises an ISO-string last_semantic_at to YYYY-MM-DD", async () => {
    mock.module("../db.ts", () => ({
      sql: {
        unsafe: () =>
          Promise.resolve([
            { doc_id: VALID_UUID, semantic_count: 1, last_semantic_at: "2025-11-21T00:00:00.000Z", content_count: 1 },
          ]),
      },
    }));
    const { handleModCounts } = await import("./mod-counts.ts");
    const body = (await (await handleModCounts()).json()) as any[];
    expect(body[0].lastModified).toBe("2025-11-21");
  });

  it("sets Cache-Control on a successful response", async () => {
    mock.module("../db.ts", () => ({
      sql: { unsafe: () => Promise.resolve([]) },
    }));
    const { handleModCounts } = await import("./mod-counts.ts");
    const res = await handleModCounts();
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(await res.json()).toEqual([]);
  });

  it("returns 503 when the DB throws", async () => {
    mock.module("../db.ts", () => ({
      sql: { unsafe: () => Promise.reject(new Error("connection refused")) },
    }));
    const { handleModCounts } = await import("./mod-counts.ts");
    const res = await handleModCounts();
    expect(res.status).toBe(503);
  });
});
