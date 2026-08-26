import { fetchJson } from "@/lib/verify";

export interface ForumTopic {
  title: string;
  url: string;
  postedAt: string;
  period: string[];
}

export function loadForumTopics(): Promise<ForumTopic[]> {
  return fetchJson<{ topics: ForumTopic[] }>("/api/forum-topics?kind=msc", "forum-topics")
    .then((p) => p.topics)
    .catch(() => []);
}
