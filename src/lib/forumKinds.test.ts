import { describe, expect, it } from "vitest";
import {
  FORUM_CYCLES,
  FORUM_EMBED_ENABLED,
  FORUM_EMBED_GRAINS,
  FORUM_ORIGIN,
  classifyForumTopic,
  shouldEmbedPost,
  stripHtml,
  tagSlugs,
  topicEmbedText,
  type ForumKind,
} from "./forumKinds";

describe("forum kinds catalog", () => {
  it("indexes MSC only for the first worker crawl", () => {
    expect(FORUM_CYCLES).toHaveLength(1);
    expect(FORUM_CYCLES[0]).toMatchObject({
      kind: "msc",
      slug: "monthly-settlement-cycle",
      forumTag: "monthly-settlement-cycle",
    });
    expect(FORUM_CYCLES[0].atlasDocId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(FORUM_CYCLES[0].forumTagUrl).toBe(
      `${FORUM_ORIGIN}/tag/monthly-settlement-cycle/1493`,
    );
  });
});

describe("classifyForumTopic", () => {
  it("matches MSC by tag even when the title is a shorthand", () => {
    expect(classifyForumTopic(["monthly-settlement-cycle", "stability-scope"], "MSC #11: May 2026")).toBe(
      "msc",
    );
  });

  it("matches MSC by title pattern when the tag is missing", () => {
    expect(classifyForumTopic([], "Monthly Settlement Cycle Report #10: April 2026")).toBe("msc");
  });

  it("does not claim AEC or spell until those cycles are indexed", () => {
    expect(classifyForumTopic(["weekly-cycle"], "Atlas Edit Weekly Cycle Proposal")).toBeNull();
    expect(classifyForumTopic(["spell"], "Proposed Changes to Grove for Upcoming Spell")).toBeNull();
  });

  it("returns null for unrelated threads", () => {
    expect(classifyForumTopic(["off-topic"], "General discussion")).toBeNull();
  });
});

describe("tagSlugs", () => {
  it("accepts Discourse objects and strings", () => {
    expect(tagSlugs([{ slug: "monthly-settlement-cycle", name: "MSC" }, "other"])).toEqual([
      "monthly-settlement-cycle",
      "other",
    ]);
  });
});

describe("stripHtml", () => {
  it("unwraps Discourse cooked HTML", () => {
    expect(stripHtml("<p>Hello <strong>world</strong></p>")).toBe("Hello world");
  });

  it("decodes entities", () => {
    expect(stripHtml("5&amp;10 &lt; 20")).toBe("5&10 < 20");
  });
});

describe("embedding grain", () => {
  it("does not spend vectors on templated MSC / weekly-edit posts", () => {
    expect(FORUM_EMBED_ENABLED).toBe(false);
    expect(FORUM_EMBED_GRAINS).toEqual(["topic", "post"]);
  });

  it("embeds the topic as title + original-post body (caller strips HTML)", () => {
    expect(topicEmbedText("MSC #11", stripHtml("<p>Report body</p>"))).toBe("MSC #11\n\nReport body");
  });

  it("embeds replies of at least 200 stripped characters, not the original post", () => {
    expect(shouldEmbedPost("short")).toBe(false);
    expect(shouldEmbedPost("x".repeat(199))).toBe(false);
    expect(shouldEmbedPost("x".repeat(200))).toBe(true);
  });
});

describe("ForumKind", () => {
  it("is the closed set of patterned cycle types", () => {
    const kinds: ForumKind[] = ["msc", "aec", "spell"];
    expect(kinds).toHaveLength(3);
  });
});
