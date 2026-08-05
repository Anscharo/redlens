// Run under `bun test` (NOT vitest) — imports Bun SQL transitively.
import { describe, it, expect, mock, beforeEach } from "bun:test";

describe("handleModTimeline", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("maps rows to the client ModTimelineRow shape", async () => {
    mock.module("../db.ts", () => ({
      sql: {
        unsafe: () =>
          Promise.resolve([
            { month: "2026-01", count: 5 },
            { month: "2026-02", count: 12 },
          ]),
      },
    }));
    const { handleModTimeline } = await import("./mod-timeline.ts");
    const res = await handleModTimeline();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { month: "2026-01", count: 5 },
      { month: "2026-02", count: 12 },
    ]);
  });

  it("sets Cache-Control on a successful response", async () => {
    mock.module("../db.ts", () => ({
      sql: { unsafe: () => Promise.resolve([]) },
    }));
    const { handleModTimeline } = await import("./mod-timeline.ts");
    const res = await handleModTimeline();
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(await res.json()).toEqual([]);
  });

  it("returns 503 when the DB throws", async () => {
    mock.module("../db.ts", () => ({
      sql: { unsafe: () => Promise.reject(new Error("connection refused")) },
    }));
    const { handleModTimeline } = await import("./mod-timeline.ts");
    const res = await handleModTimeline();
    expect(res.status).toBe(503);
  });
});
