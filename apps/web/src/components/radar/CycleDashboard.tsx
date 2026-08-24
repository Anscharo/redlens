import { useEffect, useState } from "react";
import { AtlasLink } from "../AtlasLink";
import { atlasHref } from "@/lib/routes";
import type { ForumCycle } from "@/lib/forumKinds";
import { loadForumTopics, type ForumTopic } from "../../lib/forumTopics";

interface Props {
  cycle: ForumCycle;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function CycleDashboard({ cycle }: Props) {
  const [topics, setTopics] = useState<ForumTopic[] | null>(null);

  useEffect(() => {
    let alive = true;
    void loadForumTopics(cycle.kind).then((p) => {
      if (alive) setTopics(p.topics);
    });
    return () => {
      alive = false;
    };
  }, [cycle.kind]);

  return (
    <div className="flex-1 px-6 py-6 min-w-0">
      <p className="mono text-xs mb-1" style={{ color: "var(--tan-3)" }}>
        radar · cycle
      </p>
      <h1 className="text-xl font-semibold mb-2" style={{ color: "var(--tan)" }}>
        {cycle.title}
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--tan-2)" }}>
        Forum threads tagged for this Atlas cycle. Indexed by the atlas worker
        from the public Discourse API — not the whole forum.
      </p>

      <section className="mb-8">
        <h2 className="mono text-[10px] uppercase tracking-wider mb-3" style={{ color: "var(--tan-3)" }}>
          Sources
        </h2>
        <ul className="text-sm space-y-1">
          <li>
            <AtlasLink to={atlasHref(cycle.atlasDocId)} className="text-accent hover:underline">
              Atlas definition
            </AtlasLink>
          </li>
          <li>
            <a
              href={cycle.forumTagUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              Sky Forum tag
            </a>
          </li>
        </ul>
      </section>

      <section>
        <h2 className="mono text-[10px] uppercase tracking-wider mb-3" style={{ color: "var(--tan-3)" }}>
          Forum threads
        </h2>
        {topics === null ? (
          <p className="text-sm" style={{ color: "var(--tan-3)" }}>
            Loading threads…
          </p>
        ) : topics.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--tan-2)" }}>
            No indexed threads yet.{" "}
            <a href={cycle.forumTagUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              Open the forum tag
            </a>{" "}
            for the live list.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {topics.map((t) => (
              <li key={t.topicId} className="py-2">
                <a
                  href={t.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-accent hover:underline"
                >
                  {t.title}
                </a>
                <div className="mono text-[10px] mt-0.5" style={{ color: "var(--tan-3)" }}>
                  {formatDate(t.postedAt)} · {t.poster}
                  {t.postsCount > 1 ? ` · ${t.postsCount} posts` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
