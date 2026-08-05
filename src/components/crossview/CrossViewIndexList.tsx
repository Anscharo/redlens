// In-doc rendering of the II.7 "Topics" list (docs/crossview/concepts.md,
// between the `:::index` / `:::endindex` markers CrossViewMarkdown.tsx strips
// out of the plain-markdown pass and swaps for this component). Same parsed
// entries the right-hand CrossViewTopicIndex.tsx panel renders — see
// src/lib/crossviewIndex.ts for the shared parse + target-grouping logic, so
// the two surfaces can never disagree on a target's slug.
import type { CrossViewIndexEntry } from "../../lib/crossviewIndex";
import { TargetLinks } from "./CrossViewIndexTargets";

export function CrossViewIndexList({ entries }: { entries: CrossViewIndexEntry[] }) {
  return (
    <ul className="columns-1 sm:columns-2 lg:columns-3 gap-8 text-sm mb-4">
      {entries.map((e) => (
        <li key={e.topic} className="break-inside-avoid mb-1 text-tan-2">
          {e.topic}
          <span className="text-tan-3"> → </span>
          <TargetLinks targets={e.targets} />
        </li>
      ))}
    </ul>
  );
}
