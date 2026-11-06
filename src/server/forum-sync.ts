// Sky Forum cycle-thread write path: topic and post upserts plus the
// time-gated crawl the atlas worker runs each tick (see forum.ts for the store).

import { config } from "./config.ts";
import { monthsFromMscTitle } from "../lib/forumMonths.ts";
import {
  fetchAllowlistedTopics,
  type DiscourseFetch,
  type DiscoursePost,
  type DiscourseTopic,
} from "./forum-discourse.ts";
import { toIso } from "./forum.ts";
import type { SqlTag } from "./sql-types.ts";

export async function upsertForumTopic(db: SqlTag, topic: DiscourseTopic, now: Date): Promise<void> {
  await upsertTopicRow(db, topic, monthsFromMscTitle(topic.title), now);
  for (const p of topic.posts) await upsertForumPost(db, topic.topicId, p);
}

async function upsertTopicRow(db: SqlTag, topic: DiscourseTopic, period: string[], now: Date): Promise<void> {
  await db`
    INSERT INTO forum_topics (
      topic_id, kind, title, slug, url, poster, posted_at, last_posted_at, tags, posts_count, period, op_html, synced_at
    ) VALUES (
      ${topic.topicId}, ${topic.kind}, ${topic.title}, ${topic.slug}, ${topic.url},
      ${topic.poster}, ${topic.postedAt}, ${topic.lastPostedAt}, ${topic.tags}::jsonb,
      ${topic.postsCount}, ${period}::jsonb, ${topic.opHtml}, ${now}
    )
    ON CONFLICT (topic_id) DO UPDATE SET
      kind = excluded.kind,
      title = excluded.title,
      slug = excluded.slug,
      url = excluded.url,
      poster = excluded.poster,
      posted_at = excluded.posted_at,
      last_posted_at = excluded.last_posted_at,
      tags = excluded.tags,
      posts_count = excluded.posts_count,
      period = excluded.period,
      op_html = excluded.op_html,
      synced_at = excluded.synced_at
  `;
}

async function upsertForumPost(db: SqlTag, topicId: number, p: DiscoursePost): Promise<void> {
  await db`
    INSERT INTO forum_posts (post_id, topic_id, post_number, poster, posted_at, html, reply_to_post_number)
    VALUES (
      ${p.postId}, ${topicId}, ${p.postNumber}, ${p.poster}, ${p.postedAt},
      ${p.html}, ${p.replyToPostNumber}
    )
    ON CONFLICT (post_id) DO UPDATE SET
      topic_id = excluded.topic_id,
      post_number = excluded.post_number,
      poster = excluded.poster,
      posted_at = excluded.posted_at,
      html = excluded.html,
      reply_to_post_number = excluded.reply_to_post_number
  `;
}

export async function markForumSynced(db: SqlTag, now: Date): Promise<void> {
  await db`
    INSERT INTO forum_sync_state (id, fetched_at) VALUES (1, ${now})
    ON CONFLICT (id) DO UPDATE SET fetched_at = excluded.fetched_at
  `;
}

export interface ForumSyncResult {
  synced: boolean;
  reason: "fresh" | "no-row" | "stale" | "no-timestamp" | "empty";
  ageSeconds: number | null;
  upserted: number;
}

export interface ForumSyncDeps {
  fetchTopics?: () => Promise<DiscourseTopic[]>;
  fetch?: DiscourseFetch;
  sleep?: (ms: number) => Promise<unknown>;
  now?: () => number;
  refreshSeconds?: number;
}

/**
 * Cadence gate. One cheap SELECT per worker tick; Discourse is fetched only
 * when the stored cursor is older than `refreshSeconds`. Missing row / NULL /
 * unparseable timestamp all fetch — failing toward one polite crawl beats
 * failing toward never indexing the forum.
 */
export async function maybeSyncForum(db: SqlTag, deps: ForumSyncDeps = {}): Promise<ForumSyncResult> {
  const nowMs = deps.now?.() ?? Date.now();
  const refreshSeconds = deps.refreshSeconds ?? config.forumRefreshSeconds;
  const rows = (await db`SELECT fetched_at FROM forum_sync_state WHERE id = 1`) as {
    fetched_at?: string | Date | null;
  }[];
  const row = rows[0];
  const fetchedAt = row ? toIso(row.fetched_at) : null;
  const ageSeconds = fetchedAt ? Math.floor((nowMs - new Date(fetchedAt).getTime()) / 1000) : null;

  if (row && ageSeconds !== null && ageSeconds < refreshSeconds) {
    return { synced: false, reason: "fresh", ageSeconds, upserted: 0 };
  }
  const reason: ForumSyncResult["reason"] = !row ? "no-row" : ageSeconds === null ? "no-timestamp" : "stale";

  const topics = await (deps.fetchTopics
    ? deps.fetchTopics()
    : fetchAllowlistedTopics({ fetch: deps.fetch, sleep: deps.sleep }));
  if (topics.length === 0) {
    // Don't stamp the cursor on an empty crawl — a Discourse outage would then
    // silence indexing until the interval elapsed again.
    return { synced: false, reason: "empty", ageSeconds, upserted: 0 };
  }
  const now = new Date(nowMs);
  for (const t of topics) await upsertForumTopic(db, t, now);
  await markForumSynced(db, now);
  return { synced: true, reason, ageSeconds, upserted: topics.length };
}
