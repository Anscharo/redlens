import { describe, expect, it } from "vitest";
import { fetchAllowlistedTopics, parseTopicJson } from "./forum-discourse";
import { FORUM_ORIGIN } from "../lib/forumKinds";

const USER = { id: 1, username: "SoterLabs" };

function tagPage(topics: unknown[], more = false) {
  return {
    users: [USER],
    topic_list: { topics, more_topics_url: more ? "/tag/monthly-settlement-cycle?page=1" : null },
  };
}

function topicJson(id: number, title: string) {
  return {
    id,
    slug: `topic-${id}`,
    title,
    created_at: "2026-06-01T12:00:00.000Z",
    last_posted_at: "2026-06-02T12:00:00.000Z",
    posts_count: 2,
    tags: [{ id: 1493, name: "monthly-settlement-cycle", slug: "monthly-settlement-cycle" }],
    details: { created_by: { username: "SoterLabs" } },
    post_stream: {
      posts: [
        {
          id: 10,
          post_number: 1,
          username: "SoterLabs",
          created_at: "2026-06-01T12:00:00.000Z",
          cooked: "<p>Original report</p>",
          reply_to_post_number: null,
        },
        {
          id: 11,
          post_number: 2,
          username: "adamfraser",
          created_at: "2026-06-02T12:00:00.000Z",
          cooked: "<p>Follow-up</p>",
          reply_to_post_number: 1,
        },
      ],
    },
  };
}

describe("parseTopicJson", () => {
  it("extracts the original post, tags, and replies", () => {
    const parsed = parseTopicJson(topicJson(28151, "MSC #11: May 2026"), {
      kind: "msc",
      listPoster: "SoterLabs",
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.topicId).toBe(28151);
    expect(parsed!.poster).toBe("SoterLabs");
    expect(parsed!.opHtml).toBe("<p>Original report</p>");
    expect(parsed!.tags).toEqual(["monthly-settlement-cycle"]);
    expect(parsed!.posts).toHaveLength(2);
    expect(parsed!.posts[1]).toMatchObject({
      poster: "adamfraser",
      replyToPostNumber: 1,
    });
  });
});

describe("fetchAllowlistedTopics", () => {
  it("fetches tagged topics then hydrates each thread", async () => {
    const fetchImpl = async (url: string) => {
      if (url.includes("/tag/monthly-settlement-cycle.json") && !url.includes("page=")) {
        return new Response(
          JSON.stringify(
            tagPage([
              {
                id: 28151,
                slug: "msc-11",
                title: "MSC #11: May 2026",
                posters: [{ user_id: 1, description: "Original Poster" }],
              },
            ]),
          ),
          { status: 200 },
        );
      }
      if (url.includes("/t/28151.json")) {
        return new Response(JSON.stringify(topicJson(28151, "MSC #11: May 2026")), { status: 200 });
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const topics = await fetchAllowlistedTopics({ fetch: fetchImpl, sleep: async () => {} });
    expect(topics).toHaveLength(1);
    expect(topics[0]).toMatchObject({
      kind: "msc",
      topicId: 28151,
      poster: "SoterLabs",
      url: `${FORUM_ORIGIN}/t/topic-28151/28151`,
    });
    expect(topics[0].posts).toHaveLength(2);
  });

  it("pages the tag listing while Discourse reports more_topics_url", async () => {
    const seen: string[] = [];
    const page0 = Array.from({ length: 30 }, (_, i) => ({
      id: 1000 + i,
      slug: `t-${i}`,
      title: `MSC #${i}`,
      posters: [{ user_id: 1, description: "Original Poster" }],
    }));
    const fetchImpl = async (url: string) => {
      seen.push(url);
      if (url.includes("/tag/monthly-settlement-cycle.json") && !url.includes("page=")) {
        return new Response(JSON.stringify(tagPage(page0, true)), { status: 200 });
      }
      if (url.includes("page=1")) {
        return new Response(
          JSON.stringify(
            tagPage([
              {
                id: 2000,
                slug: "last",
                title: "MSC last",
                posters: [{ user_id: 1, description: "Original Poster" }],
              },
            ]),
          ),
          { status: 200 },
        );
      }
      const m = url.match(/\/t\/(\d+)\.json/);
      if (m) {
        const id = Number(m[1]);
        return new Response(JSON.stringify(topicJson(id, `MSC ${id}`)), { status: 200 });
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const topics = await fetchAllowlistedTopics({ fetch: fetchImpl, sleep: async () => {} });
    expect(topics).toHaveLength(31);
    expect(seen.some((u) => u.includes("page=1"))).toBe(true);
  });
});
