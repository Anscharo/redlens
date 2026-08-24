import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("loadForumTopics", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("reads /api/forum-topics with the kind query", async () => {
    const payload = {
      topics: [{ topicId: 1, kind: "msc", title: "MSC #11", url: "https://forum.skyeco.com/t/1" }],
      fetchedAt: "2026-08-24T12:00:00.000Z",
    };
    globalThis.fetch = vi.fn(async (url: string) => {
      expect(String(url)).toBe("/api/forum-topics?kind=msc");
      return { ok: true, status: 200, json: async () => payload } as Response;
    }) as unknown as typeof fetch;

    const { loadForumTopics } = await import("./forumTopics");
    expect(await loadForumTopics("msc")).toEqual(payload);
  });

  it("returns an empty list when the API is down", async () => {
    globalThis.fetch = vi.fn(async () => {
      return { ok: false, status: 503, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;

    const { loadForumTopics } = await import("./forumTopics");
    expect(await loadForumTopics("msc")).toEqual({ topics: [], fetchedAt: null });
  });
});
