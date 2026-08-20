import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { Link } from "./Link";
import { ROUTES } from "@/lib/routes";
import notesRaw from "../../patch-notes.md?raw";
import { parsePatchNotes, formatPatchDate, type PatchNoteGroup } from "@/lib/patchNotes";

// Input is static (bundled via Vite ?raw), so parse once at module scope.
const recentGroups = parsePatchNotes(notesRaw);

// Render a bullet's markdown inline. Internal "/" links navigate in-SPA via
// <Link> (so they respect the router base and don't full-reload); external
// links open in a new tab. <p> is unwrapped so the text stays inside the <li>.
const components: Components = {
  p: ({ children }) => <>{children}</>,
  a: ({ href, children }) =>
    href?.startsWith("/") ? (
      <Link to={href} className="link-accent">
        {children}
      </Link>
    ) : (
      <a href={href} className="link-accent" target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ),
};

// Date-grouped bullet list, shared between the homepage teaser and the
// full-history /updates page.
export function PatchNoteGroups({ groups }: { groups: PatchNoteGroup[] }) {
  return (
    <div className="flex flex-col gap-4" style={{ maxWidth: "74ch" }}>
      {groups.map((g) => (
        <article key={g.date}>
          <time dateTime={g.date} className="text-lg text-tan-3">
            {formatPatchDate(g.date)}
          </time>
          <ul className="mt-1 list-disc list-inside text-base text-tan-2 leading-relaxed">
            {g.items.map((item, i) => (
              <li key={i}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                  {item}
                </ReactMarkdown>
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

export function PatchNotes() {
  if (recentGroups.length === 0) return null;
  return (
    <section className="mt-20">
      <hr className="mb-10 border-t" style={{ borderColor: "var(--hover)" }} />
      <h2 className="text-3xl font-semibold text-tan mb-4">Recent improvements</h2>
      <PatchNoteGroups groups={recentGroups} />
      <Link to={ROUTES.UPDATES} className="link-accent inline-block mt-4 text-sm">
        View all updates <span className="enlargen">→</span>
      </Link>
    </section>
  );
}
