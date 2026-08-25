// Discourse JSON client for the allowlisted Sky Forum tags. No auth — the
// tagged cycle threads are public. Inject `fetch`/`sleep` so tests never hit
// the network. The worker is the only production caller.

import { classifyForumTopic, FORUM_CYCLES, FORUM_ORIGIN, tagSlugs, type ForumKind } from "../lib/forumKinds.ts";

export interface DiscourseTopic {
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
  opHtml: string;
  posts: DiscoursePost[];
}

export interface DiscoursePost {
  postId: number;
  postNumber: number;
  poster: string;
  postedAt: string;
  html: string;
  replyToPostNumber: number | null;
}

export interface DiscourseFetch {
  (url: string, init?: RequestInit): Promise<Response>;
}

const UA = "redline-atlas-forum-sync";

/** Retry backoff: 500ms, then 1s. Injectable so tests never actually wait. */
const RETRY_BASE_MS = 500;

const defaultSleep = (ms: number): Promise<unknown> => new Promise((r) => setTimeout(r, ms));

/**
 * Retry only what a second request could plausibly fix: 429 (we crawled too
 * fast) and 5xx (Discourse hiccup). Every other 4xx — a deleted, moved or
 * staff-only topic — is permanent, so retrying spends two more requests to
 * arrive at the same error.
 */
function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export interface GetJsonOpts {
  tries?: number;
  sleep?: (ms: number) => Promise<unknown>;
}

export async function getJson(
  url: string,
  fetchImpl: DiscourseFetch,
  opts: GetJsonOpts = {},
): Promise<unknown> {
  const tries = opts.tries ?? 3;
  const sleep = opts.sleep ?? defaultSleep;
  let last: Error | null = null;
  for (let attempt = 0; attempt < tries; attempt++) {
    if (attempt > 0) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1));
    let res: Response;
    try {
      res = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": UA } });
    } catch (e) {
      // Network-level failure (DNS, reset, timeout) — always worth retrying.
      last = e as Error;
      continue;
    }
    if (!res.ok) {
      const err = new Error(`GET ${url} → ${res.status}`);
      if (!retryableStatus(res.status)) throw err;
      last = err;
      continue;
    }
    try {
      return await res.json();
    } catch (e) {
      last = new Error(`GET ${url} → bad JSON: ${(e as Error).message}`);
    }
  }
  throw last ?? new Error(`GET ${url} failed`);
}

interface TagListTopic {
  id: number;
  title: string;
  slug: string;
  posts_count?: number;
  created_at?: string;
  last_posted_at?: string | null;
  tags?: unknown;
  posters?: { user_id: number; description?: string }[];
}

interface TagListUser {
  id: number;
  username: string;
}

function posterFromList(topic: TagListTopic, users: TagListUser[]): string {
  const byId = new Map(users.map((u) => [u.id, u.username]));
  const op = topic.posters?.find((p) => /original poster/i.test(p.description ?? ""));
  const uid = op?.user_id ?? topic.posters?.[0]?.user_id;
  return (uid != null && byId.get(uid)) || "unknown";
}

export function tagListUrl(origin: string, tag: string, page: number): string {
  const base = `${origin}/tag/${encodeURIComponent(tag)}.json`;
  return page > 0 ? `${base}?page=${page}` : base;
}

export function topicUrl(origin: string, slug: string, id: number): string {
  return `${origin}/t/${slug}/${id}`;
}

export function topicJsonUrl(origin: string, id: number): string {
  return `${origin}/t/${id}.json`;
}

export async function listTaggedTopics(
  tag: string,
  opts: { origin?: string; fetch?: DiscourseFetch; sleep?: (ms: number) => Promise<unknown> } = {},
): Promise<{ topics: TagListTopic[]; users: TagListUser[] }> {
  const origin = opts.origin ?? FORUM_ORIGIN;
  const fetchImpl = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const out: TagListTopic[] = [];
  const users: TagListUser[] = [];
  const seen = new Set<number>();
  const seenUser = new Set<number>();
  for (let page = 0; page < 50; page++) {
    const body = (await getJson(tagListUrl(origin, tag, page), fetchImpl, { sleep })) as {
      users?: TagListUser[];
      topic_list?: { topics?: TagListTopic[]; more_topics_url?: string | null };
    };
    for (const u of body.users ?? []) {
      if (seenUser.has(u.id)) continue;
      seenUser.add(u.id);
      users.push(u);
    }
    const topics = body.topic_list?.topics ?? [];
    for (const t of topics) {
      if (typeof t.id !== "number" || seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
    if (!body.topic_list?.more_topics_url || topics.length === 0) break;
  }
  return { topics: out, users };
}

interface TopicJsonPost {
  id: number;
  post_number: number;
  username?: string;
  created_at?: string;
  cooked?: string;
  reply_to_post_number?: number | null;
}

export function parseTopicJson(
  raw: unknown,
  fallback: { kind: ForumKind; listPoster: string; origin?: string },
): DiscourseTopic | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as {
    id?: number;
    title?: string;
    slug?: string;
    created_at?: string;
    last_posted_at?: string | null;
    posts_count?: number;
    tags?: unknown;
    details?: { created_by?: { username?: string } };
    post_stream?: { posts?: TopicJsonPost[] };
  };
  if (typeof t.id !== "number" || !t.title || !t.slug) return null;
  const kind = classifyForumTopic(t.tags, t.title) ?? fallback.kind;
  const posts = (t.post_stream?.posts ?? []).map((p): DiscoursePost => ({
    postId: p.id,
    postNumber: p.post_number,
    poster: p.username ?? "unknown",
    postedAt: p.created_at ?? t.created_at ?? new Date(0).toISOString(),
    html: p.cooked ?? "",
    replyToPostNumber: p.reply_to_post_number ?? null,
  }));
  const op = posts.find((p) => p.postNumber === 1);
  return {
    topicId: t.id,
    kind,
    title: t.title,
    slug: t.slug,
    url: topicUrl(fallback.origin ?? FORUM_ORIGIN, t.slug, t.id),
    poster: t.details?.created_by?.username ?? op?.poster ?? fallback.listPoster,
    postedAt: t.created_at ?? op?.postedAt ?? new Date(0).toISOString(),
    lastPostedAt: t.last_posted_at ?? null,
    tags: tagSlugs(t.tags),
    postsCount: t.posts_count ?? posts.length,
    opHtml: op?.html ?? "",
    posts,
  };
}

export async function fetchAllowlistedTopics(opts: {
  origin?: string;
  fetch?: DiscourseFetch;
  sleep?: (ms: number) => Promise<unknown>;
} = {}): Promise<DiscourseTopic[]> {
  const origin = opts.origin ?? FORUM_ORIGIN;
  const fetchImpl = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const out: DiscourseTopic[] = [];
  const seen = new Set<number>();

  // Nothing here may abort the crawl. `maybeSyncForum` only starts writing
  // once this resolves and never advances its cursor on a throw, so one
  // permanently dead thread (deleted, moved, staff-only) would discard every
  // sibling fetched in the same pass and wedge indexing on every worker tick.
  // Skip the casualty, keep the rest, let the next crawl retry it.
  for (const cycle of FORUM_CYCLES) {
    let listed: { topics: TagListTopic[]; users: TagListUser[] };
    try {
      listed = await listTaggedTopics(cycle.forumTag, { origin, fetch: fetchImpl, sleep });
    } catch (e) {
      console.warn(`forum: tag ${cycle.forumTag} unavailable — ${(e as Error).message}`);
      continue;
    }
    for (const row of listed.topics) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      try {
        const raw = await getJson(topicJsonUrl(origin, row.id), fetchImpl, { sleep });
        const parsed = parseTopicJson(raw, {
          kind: cycle.kind,
          listPoster: posterFromList(row, listed.users),
          origin,
        });
        if (parsed && parsed.poster === "unknown") {
          parsed.poster = posterFromList(row, listed.users);
        }
        if (parsed) out.push(parsed);
      } catch (e) {
        console.warn(`forum: skipping topic ${row.id} — ${(e as Error).message}`);
      }
      await sleep(150);
    }
  }
  return out;
}
