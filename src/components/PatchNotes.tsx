import notesRaw from "../content/patch-notes.md?raw";
import { parsePatchNotes, formatPatchDate } from "../lib/patchNotes";

// Input is static (bundled via Vite ?raw), so parse once at module scope.
const groups = parsePatchNotes(notesRaw);

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
                <li key={i}>{item}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
