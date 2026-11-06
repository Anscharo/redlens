// Sky Forum cycle-thread store: worker write path + public read route.
//
//   GET /api/forum-topics?kind=msc → { topics, fetchedAt }
//
// The atlas worker is the only writer (maybeSyncForum, in forum-sync.ts). Indexing never runs
// on the web request thread. Cadence is time-gated like chain-state — the
// worker tick is ~12 minutes; Discourse must not be hit every tick.
//
// Do not fill forum_embeddings: MSC / weekly-edit bodies are templates
// (FORUM_EMBED_ENABLED in forumKinds.ts). Period lives on forum_topics.period.

import { sql } from "./db.ts";
import { json } from "./http.ts";
import { isForumKind, type ForumKind } from "../lib/forumKinds.ts";
import type { SqlTag } from "./sql-types.ts";
import { toIso } from "./to-iso.ts";


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
