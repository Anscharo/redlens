// Sky Forum cycle-thread store: worker write path + public read route.
//
//   GET /api/forum-topics?kind=msc → { topics, fetchedAt }
//
// The atlas worker is the only writer (maybeSyncForum). Indexing never runs
// on the web request thread. Cadence is time-gated like chain-state — the
// worker tick is ~12 minutes; Discourse must not be hit every tick.
//
// Do not fill forum_embeddings: MSC / weekly-edit bodies are templates
// (FORUM_EMBED_ENABLED in forumKinds.ts). Period lives on forum_topics.period.

import { sql } from "./db.ts";
import { json } from "./http.ts";
import { config } from "./config.ts";
import { isForumKind, type ForumKind } from "../lib/forumKinds.ts";
import { monthsFromMscTitle } from "../lib/forumMonths.ts";
import {
  fetchAllowlistedTopics,
  type DiscourseFetch,
  type DiscoursePost,
  type DiscourseTopic,
} from "./forum-discourse.ts";

type SqlTag = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

export interface ForumTopicRow {
  topicId: number;
  kind: ForumKind;
  title: string;
  slug: string;
  url: string;
  poster: string;
  postedAt: string;
  lastPostedAt: string | null;
  tags: string[];
  postsCount: number;
  period: string[];
}

export interface ForumTopicsPayload {
  topics: ForumTopicRow[];
  fetchedAt: string | null;
}

function toIso(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function asTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

interface TopicDbRow {
  topic_id: number;
  kind: string;
  title: string;
  slug: string;
  url: string;
  poster: string;
  posted_at: string | Date;
  last_posted_at?: string | Date | null;
  tags?: unknown;
  posts_count?: number;
  period?: unknown;
}

function toTopicRow(r: TopicDbRow): ForumTopicRow {
  return {
    topicId: r.topic_id,
    kind: r.kind as ForumKind,
    title: r.title,
    slug: r.slug,
    url: r.url,
    poster: r.poster,
    postedAt: toIso(r.posted_at) ?? "",
    lastPostedAt: toIso(r.last_posted_at ?? null),
    tags: asTags(r.tags),
    postsCount: r.posts_count ?? 0,
    period: asTags(r.period),
  };
}

export async function readForumTopics(db: SqlTag = sql, kind?: ForumKind): Promise<ForumTopicRow[]> {
  const rows = kind
    ? ((await db`
        SELECT topic_id, kind, title, slug, url, poster, posted_at, last_posted_at, tags, posts_count, period
        FROM forum_topics WHERE kind = ${kind}
        ORDER BY posted_at DESC
      `) as TopicDbRow[])
    : ((await db`
        SELECT topic_id, kind, title, slug, url, poster, posted_at, last_posted_at, tags, posts_count, period
        FROM forum_topics
        ORDER BY posted_at DESC
      `) as TopicDbRow[]);
  return (rows ?? []).map(toTopicRow);
}

export async function readForumFetchedAt(db: SqlTag = sql): Promise<string | null> {
  const rows = (await db`SELECT fetched_at FROM forum_sync_state WHERE id = 1`) as {
    fetched_at?: string | Date | null;
  }[];
  return toIso(rows[0]?.fetched_at ?? null);
}

export async function upsertForumTopic(db: SqlTag, topic: DiscourseTopic, now: Date): Promise<void> {
  const period = monthsFromMscTitle(topic.title);
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
  for (const p of topic.posts) await upsertForumPost(db, topic.topicId, p);
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

export async function handleForumTopics(req: Request): Promise<Response> {
  try {
    const kindParam = new URL(req.url).searchParams.get("kind");
    if (kindParam && !isForumKind(kindParam)) {
      return json({ error: "unknown kind" }, 400);
    }
    const kind = kindParam && isForumKind(kindParam) ? kindParam : undefined;
    const [topics, fetchedAt] = await Promise.all([readForumTopics(sql, kind), readForumFetchedAt()]);
    return json({ topics, fetchedAt } satisfies ForumTopicsPayload, 200, {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  } catch (e) {
    console.error(`forum-topics: ${(e as Error).message}`);
    return json({ error: "unavailable" }, 503);
  }
}
