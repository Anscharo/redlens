import type { ReactNode } from "react";
import { Link } from "./Link";
import notesRaw from "../content/patch-notes.md?raw";
import { parsePatchNotes, formatPatchDate } from "../lib/patchNotes";

// Input is static (bundled via Vite ?raw), so parse once at module scope.
const groups = parsePatchNotes(notesRaw);

// Inline `[label](href)` markdown links inside a bullet. Internal paths
// (starting with "/") navigate in-SPA via <Link>; anything else is treated as
// an external anchor. Everything outside a link renders as plain text.
const LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
function renderBullet(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(LINK_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const [, label, href] = m;
    out.push(
      href.startsWith("/") ? (
        <Link key={key++} to={href} className="link-accent">
          {label}
        </Link>
      ) : (
        <a key={key++} href={href} className="link-accent" target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      ),
    );
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function PatchNotes() {
  if (groups.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="text-3xl font-semibold text-tan mb-4">Recent improvements</h2>
      <div className="flex flex-col gap-4">
        {groups.map((g) => (
          <article key={g.date}>
            <time dateTime={g.date} className="text-lg text-tan-3">
              {formatPatchDate(g.date)}
            </time>
            <ul className="mt-1 list-disc list-inside text-lg text-tan-2 leading-relaxed">
              {g.items.map((item, i) => (
                <li key={i}>{renderBullet(item)}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
