// Right-hand "Topics" panel for the Concepts tab — the wide-viewport
// alternative to reading the in-doc II.7 list (LibraryIndexList.tsx). Parses
// the same II.7 section straight out of the raw markdown source (mirrors
// LibraryToc.tsx / libraryHeadings.ts's parse-the-source approach — no DOM
// query), so it stays correct even before the doc has rendered.
import { useMemo } from "react";
import conceptsRaw from "../../../docs/library/concepts.md?raw";
import { extractHeadings } from "../../lib/libraryHeadings";
import { parseLibraryIndex } from "../../lib/libraryIndex";
import { TargetLinks } from "./LibraryIndexTargets";

const PANEL_TOP = 80; // matches LibraryToc's TOC_TOP — same sticky offset math

export function LibraryTopicIndex() {
  const headings = useMemo(() => extractHeadings(conceptsRaw), []);
  const entries = useMemo(() => parseLibraryIndex(conceptsRaw, headings), [headings]);
  const sorted = useMemo(
    () => [...entries].sort((a, b) => a.topic.toLowerCase().localeCompare(b.topic.toLowerCase())),
    [entries],
  );

  return (
    <nav
      aria-label="Topics"
      className="hidden xl:block shrink-0 w-56 text-xs overflow-y-auto"
      style={{ position: "sticky", top: PANEL_TOP, maxHeight: `calc(100vh - ${PANEL_TOP}px - 1rem)` }}
    >
      <p className="mono uppercase tracking-wider text-[var(--tan-3)] mb-2">Topics</p>
      <ul>
        {sorted.map((e) => (
          <li key={e.topic} className="py-0.5 text-[var(--tan-3)]">
            <span className="text-[var(--tan-2)]">{e.topic}</span>
            <span> → </span>
            <TargetLinks targets={e.targets} />
          </li>
        ))}
      </ul>
    </nav>
  );
}
