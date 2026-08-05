// Run under `bun test` (NOT vitest) — imports Bun SQL transitively.
import { describe, it, expect, mock, beforeEach } from "bun:test";

function reqFor(url: string): Request {
  return new Request(url);
}

describe("handleModTimeline", () => {
  beforeEach(() => {
    mock.restore();
  });

  it("defaults to month granularity and maps rows to {period, count}", async () => {
    mock.module("../db.ts", () => ({
      sql: {
        unsafe: () =>
          Promise.resolve([
            { period: "2026-01", count: 5 },
            { period: "2026-02", count: 12 },
          ]),
      },
    }));
    const { handleModTimeline } = await import("./mod-timeline.ts");
    const res = await handleModTimeline(reqFor("https://x/api/history/mod-timeline"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { period: "2026-01", count: 5 },
      { period: "2026-02", count: 12 },
    ]);
  });

  it("granularity=week maps rows to {period, count}", async () => {
    mock.module("../db.ts", () => ({
      sql: { unsafe: () => Promise.resolve([{ period: "2026-01-05", count: 3 }]) },
    }));
    const { handleModTimeline } = await import("./mod-timeline.ts");
    const res = await handleModTimeline(reqFor("https://x/api/history/mod-timeline?granularity=week"));
    expect(await res.json()).toEqual([{ period: "2026-01-05", count: 3 }]);
  });

  it("granularity=commit maps rows to {seq, sha, date, count} and normalises the date", async () => {
    mock.module("../db.ts", () => ({
      sql: {
        unsafe: () =>
          Promise.resolve([
            { seq: 42, sha: "a1b2c3d4e5f6", date: new Date("2026-01-05T10:00:00-07:00"), count: 2 },
            { seq: 43, sha: "mip:104:14.3", date: null, count: 1 },
          ]),
      },
    }));
    const { handleModTimeline } = await import("./mod-timeline.ts");
    const res = await handleModTimeline(reqFor("https://x/api/history/mod-timeline?granularity=commit"));
    expect(await res.json()).toEqual([
      { seq: 42, sha: "a1b2c3d4e5f6", date: "2026-01-05", count: 2 },
      { seq: 43, sha: "mip:104:14.3", date: null, count: 1 },
    ]);
  });

  it("an unrecognized granularity value falls back to month", async () => {
    mock.module("../db.ts", () => ({
      sql: { unsafe: () => Promise.resolve([{ period: "2026-01", count: 1 }]) },
    }));
    const { handleModTimeline } = await import("./mod-timeline.ts");
    const res = await handleModTimeline(reqFor("https://x/api/history/mod-timeline?granularity=year"));
    expect(await res.json()).toEqual([{ period: "2026-01", count: 1 }]);
  });

  it("sets Cache-Control on a successful response", async () => {
    mock.module("../db.ts", () => ({
      sql: { unsafe: () => Promise.resolve([]) },
    }));
    const { handleModTimeline } = await import("./mod-timeline.ts");
    const res = await handleModTimeline(reqFor("https://x/api/history/mod-timeline"));
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(await res.json()).toEqual([]);
  });

  it("returns 503 when the DB throws", async () => {
    mock.module("../db.ts", () => ({
      sql: { unsafe: () => Promise.reject(new Error("connection refused")) },
    }));
    const { handleModTimeline } = await import("./mod-timeline.ts");
    const res = await handleModTimeline(reqFor("https://x/api/history/mod-timeline"));
    expect(res.status).toBe(503);
  });

  it("returns 503 when the DB throws on commit granularity too", async () => {
    mock.module("../db.ts", () => ({
      sql: { unsafe: () => Promise.reject(new Error("connection refused")) },
    }));
    const { handleModTimeline } = await import("./mod-timeline.ts");
    const res = await handleModTimeline(reqFor("https://x/api/history/mod-timeline?granularity=commit"));
    expect(res.status).toBe(503);
  });
});
