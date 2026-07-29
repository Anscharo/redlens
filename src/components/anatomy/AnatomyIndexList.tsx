// In-doc rendering of the II.7 "Topics" list (docs/anatomy/concepts.md,
// between the `:::index` / `:::endindex` markers AnatomyMarkdown.tsx strips
// out of the plain-markdown pass and swaps for this component). Same parsed
// entries the right-hand AnatomyTopicIndex.tsx panel renders — see
// src/lib/anatomyIndex.ts for the shared parse + target-grouping logic, so
// the two surfaces can never disagree on a target's slug.
import type { AnatomyIndexEntry } from "../../lib/anatomyIndex";
import { TargetLinks } from "./AnatomyIndexTargets";

export function AnatomyIndexList({ entries }: { entries: AnatomyIndexEntry[] }) {
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
