import type { RadarSearchGroup as Group } from "@/lib/radarSearch";
import { RadarSearchGroup } from "./RadarSearchGroup";

interface Props {
  query: string;
  groups: Group[];
}

export function RadarSearchResults({ query, groups }: Props) {
  const total = groups.reduce((n, g) => n + g.total, 0);
  return (
    <div className="flex-1 px-6 py-6 min-w-0">
      <div className="max-w-3xl mx-auto">
        <p className="mono text-xs mb-6" style={{ color: "var(--tan-3)" }} role="status">
          {total === 0
            ? `No actor, instance, parameter, address or relationship matches “${query.trim()}”.`
            : `${total} ${total === 1 ? "match" : "matches"} for “${query.trim()}”`}
        </p>
        {groups.map((g) => (
          <RadarSearchGroup key={g.kind} group={g} />
        ))}
      </div>
    </div>
  );
}
