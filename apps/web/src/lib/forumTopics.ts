import { fetchJson } from "@/lib/verify";
import type { ForumKind } from "@/lib/forumKinds";

export interface ForumTopic {
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
}

export interface ForumTopicsPayload {
  topics: ForumTopic[];
  fetchedAt: string | null;
}

// Same-origin /api, not the sha-keyed atlas base: forum rows are worker-written
// and shared across atlas versions (a preview reuses main's crawl).
export function loadForumTopics(kind?: ForumKind): Promise<ForumTopicsPayload> {
  const q = kind ? `?kind=${encodeURIComponent(kind)}` : "";
  return fetchJson<ForumTopicsPayload>(`/api/forum-topics${q}`, "forum-topics").catch(() => ({
    topics: [],
    fetchedAt: null,
  }));
}
