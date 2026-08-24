// forum.ts — worker cadence gate, upsert, and the public read route.
//
// THE point of this file is the cadence guard: the atlas worker cycle runs every
// ~12 minutes and Discourse must not be hit every tick. Assertions are about
// whether `fetchTopics` was CALLED, not about a predicate's return value.
//
// DB MOCKING — gate/storage functions take their `sql` tag as a parameter
// (same seam as chain-state.ts), so these tests pass a fake directly. Only
// handleForumTopics() reaches for the shared `sql`, which is why that one
// gets the module mock.
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { toUuidArrayLiteral, fromUuidArray } from "./pg-array.ts";
import type { DiscourseTopic } from "./forum-discourse.ts";

interface Recorded {
  text: string;
  values: unknown[];
}
let queries: Recorded[] = [];
let syncRow: Record<string, unknown> | null = null;
let topicRows: Record<string, unknown>[] = [];
let readThrows: string | null = null;

const fakeSql = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> => {
  const text = strings.join("?");
  queries.push({ text, values });
  if (readThrows && (text.includes("FROM forum_topics") || text.includes("FROM forum_sync_state"))) {
    throw new Error(readThrows);
  }
  if (text.includes("FROM forum_sync_state")) {
    return syncRow ? [syncRow] : [];
  }
  if (text.includes("FROM forum_topics")) {
    return topicRows;
  }
  return [];
};

mock.module("./db.ts", () => ({
  sql: fakeSql,
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
  toUuidArrayLiteral,
  fromUuidArray,
}));

const { readForumTopics, upsertForumTopic, maybeSyncForum, handleForumTopics } = await import("./forum.ts");

const NOW = Date.UTC(2026, 7, 24, 12, 0, 0);
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000);

const TOPIC: DiscourseTopic = {
  topicId: 28151,
  kind: "msc",
  title: "MSC #11: May 2026",
  slug: "msc-11",
  url: "https://forum.skyeco.com/t/msc-11/28151",
  poster: "SoterLabs",
  postedAt: "2026-06-01T12:00:00.000Z",
  lastPostedAt: "2026-06-02T12:00:00.000Z",
  tags: ["monthly-settlement-cycle"],
  postsCount: 2,
  opHtml: "<p>Original report</p>",
  posts: [
    {
      postId: 10,
      postNumber: 1,
      poster: "SoterLabs",
      postedAt: "2026-06-01T12:00:00.000Z",
      html: "<p>Original report</p>",
      replyToPostNumber: null,
    },
  ],
};

beforeEach(() => {
  queries = [];
  syncRow = null;
  topicRows = [];
  readThrows = null;
});

describe("maybeSyncForum (cadence guard)", () => {
  it("does NOT fetch when the stored cursor is younger than the refresh interval", async () => {
    syncRow = { fetched_at: hoursAgo(0.5) };
    let fetches = 0;
    const res = await maybeSyncForum(fakeSql, {
      fetchTopics: async () => {
        fetches++;
        return [TOPIC];
      },
      now: () => NOW,
      refreshSeconds: 3_600,
    });
    expect(fetches).toBe(0);
    expect(res).toMatchObject({ synced: false, reason: "fresh", upserted: 0 });
    expect(res.ageSeconds).toBe(1800);
    expect(queries.every((q) => !q.text.includes("INSERT INTO forum_topics"))).toBe(true);
  });

  it("fetches and upserts when the stored cursor is older than the refresh interval", async () => {
    syncRow = { fetched_at: hoursAgo(2) };
    let fetches = 0;
    const res = await maybeSyncForum(fakeSql, {
      fetchTopics: async () => {
        fetches++;
        return [TOPIC];
      },
      now: () => NOW,
      refreshSeconds: 3_600,
    });
    expect(fetches).toBe(1);
    expect(res).toMatchObject({ synced: true, reason: "stale", upserted: 1 });
    const insert = queries.find((q) => q.text.includes("INSERT INTO forum_topics"))!;
    expect(insert).toBeDefined();
    expect(insert.values).toContainEqual(TOPIC.tags);
    expect(insert.text).toContain("::jsonb");
    expect(queries.some((q) => q.text.includes("INSERT INTO forum_posts"))).toBe(true);
    expect(queries.some((q) => q.text.includes("INSERT INTO forum_sync_state"))).toBe(true);
  });

  it("fetches when there is no row, and when the row has no usable timestamp", async () => {
    for (const [label, r, reason] of [
      ["no row", null, "no-row"],
      ["null timestamp", { fetched_at: null }, "no-timestamp"],
      ["unparseable timestamp", { fetched_at: "not-a-date" }, "no-timestamp"],
    ] as const) {
      queries = [];
      syncRow = r as Record<string, unknown> | null;
      let fetches = 0;
      const res = await maybeSyncForum(fakeSql, {
        fetchTopics: async () => {
          fetches++;
          return [TOPIC];
        },
        now: () => NOW,
      });
      expect(fetches, label).toBe(1);
      expect(res.reason, label).toBe(reason);
      expect(res.synced, label).toBe(true);
    }
  });

  it("does not stamp the cursor when the crawl returns no topics", async () => {
    syncRow = { fetched_at: hoursAgo(24) };
    const res = await maybeSyncForum(fakeSql, {
      fetchTopics: async () => [],
      now: () => NOW,
      refreshSeconds: 3_600,
    });
    expect(res).toMatchObject({ synced: false, reason: "empty", upserted: 0 });
    expect(queries.every((q) => !q.text.includes("INSERT INTO forum_sync_state"))).toBe(true);
    expect(queries.every((q) => !q.text.includes("INSERT INTO forum_topics"))).toBe(true);
  });
});

describe("upsertForumTopic", () => {
  it("writes the topic then each post", async () => {
    await upsertForumTopic(fakeSql, TOPIC, new Date(NOW));
    expect(queries.filter((q) => q.text.includes("INSERT INTO forum_topics"))).toHaveLength(1);
    expect(queries.filter((q) => q.text.includes("INSERT INTO forum_posts"))).toHaveLength(1);
  });
});

describe("readForumTopics", () => {
  it("maps a db row to the public payload shape", async () => {
    topicRows = [
      {
        topic_id: 28151,
        kind: "msc",
        title: "MSC #11: May 2026",
        slug: "msc-11",
        url: TOPIC.url,
        poster: "SoterLabs",
        posted_at: hoursAgo(1),
        last_posted_at: hoursAgo(0.5),
        tags: ["monthly-settlement-cycle"],
        posts_count: 2,
      },
    ];
    const rows = await readForumTopics(fakeSql, "msc");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ topicId: 28151, kind: "msc", poster: "SoterLabs", postsCount: 2 });
    expect(queries.some((q) => q.text.includes("kind = ?"))).toBe(true);
  });
});

describe("handleForumTopics", () => {
  it("400s on an unknown kind", async () => {
    const res = await handleForumTopics(new Request("http://x/api/forum-topics?kind=nope"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown kind" });
  });

  it("serves stored topics with a cache header", async () => {
    syncRow = { fetched_at: hoursAgo(1) };
    topicRows = [
      {
        topic_id: 28151,
        kind: "msc",
        title: "MSC #11: May 2026",
        slug: "msc-11",
        url: TOPIC.url,
        poster: "SoterLabs",
        posted_at: hoursAgo(2),
        last_posted_at: null,
        tags: ["monthly-settlement-cycle"],
        posts_count: 1,
      },
    ];
    const res = await handleForumTopics(new Request("http://x/api/forum-topics?kind=msc"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    const body = (await res.json()) as { topics: { topicId: number }[]; fetchedAt: string };
    expect(body.topics).toHaveLength(1);
    expect(body.topics[0].topicId).toBe(28151);
    expect(body.fetchedAt).toBe(hoursAgo(1).toISOString());
  });

  it("503s instead of throwing when the DB read fails", async () => {
    readThrows = "connection refused";
    const res = await handleForumTopics(new Request("http://x/api/forum-topics"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "unavailable" });
  });
});
