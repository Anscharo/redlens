// Left-side mini table of contents for the Concepts tab only. Built by
// parsing the raw markdown source once (libraryHeadings.ts) — the SAME
// extraction LibraryMarkdown/rehypeHeadingIds use to stamp heading ids — so a
// TOC entry's href always matches the id actually on the rendered heading,
// with no separate DOM query needed.
import { useMemo } from "react";
import conceptsRaw from "../../../docs/library/concepts.md?raw";
import { extractHeadings } from "../../lib/libraryHeadings";

// Sticky within the page's own scroll (this route is windowScroll — see
// App.tsx), just below the app's sticky search header (64px) plus a little
// breathing room; capped to the viewport so a long outline scrolls on its
// own rather than running off-screen.
const TOC_TOP = 80;

export function LibraryToc() {
  const headings = useMemo(() => extractHeadings(conceptsRaw), []);

  return (
    <nav
      aria-label="Concepts contents"
      className="hidden lg:block shrink-0 w-48 text-xs overflow-y-auto"
      style={{ position: "sticky", top: TOC_TOP, maxHeight: `calc(100vh - ${TOC_TOP}px - 1rem)` }}
    >
      <ul>
        {headings.map((h) => (
          <li key={h.slug} className={h.level === 3 ? "pl-3" : undefined}>
            <a
              href={`#${h.slug}`}
              title={h.text}
              className="block truncate py-0.5 text-[var(--tan-3)] hover:text-[var(--tan)]"
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
