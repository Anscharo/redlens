import { useEffect, useMemo, useState } from "react";
import { parsePreviewInput, localPreviews } from "../../lib/previewLocal";

// /preview index: paste a PR / branch / fork URL (or id) → generate a preview;
// below, the previews this browser has opened (localStorage) unioned with
// everything live in the DB (GET /api/preview/list).

interface DbRow {
  sha: string;
  repo: string;
  ref: string;
  kind: string;
  pr_number: number | null;
  pr_title: string | null;
  pr_author: string | null;
  pr_state: string | null;
  doc_count: number;
  last_access: string;
}

interface Entry {
  id: string;
  title?: string;
  detail: string;
  at: number;
}

const CANONICAL_OWNER = "sky-ecosystem";

function rowId(r: DbRow): string {
  if (r.kind === "pr" && r.pr_number) return `pull-${r.pr_number}`;
  const owner = r.repo.split("/")[0];
  const ref = r.ref.replaceAll("/", "~");
  if (r.kind === "branch") return owner === CANONICAL_OWNER ? ref : `${owner}:${ref}`;
  return r.sha;
}

function mergeEntries(rows: DbRow[]): Entry[] {
  const bySha = new Map(rows.map((r) => [r.sha, r]));
  const out = new Map<string, Entry>();
  for (const r of rows) {
    const id = rowId(r);
    out.set(id, {
      id,
      title: r.pr_title ?? undefined,
      detail: [r.pr_author && `by ${r.pr_author}`, r.pr_state && r.pr_state !== "open" && r.pr_state, `${r.doc_count} docs`]
        .filter(Boolean)
        .join(" · "),
      at: Date.parse(r.last_access) || 0,
    });
  }
  for (const l of localPreviews()) {
    const db = bySha.get(l.sha);
    if (!out.has(l.id)) {
      out.set(l.id, { id: l.id, title: db?.pr_title ?? undefined, detail: db ? `${db.doc_count} docs` : "opened here", at: l.at });
    } else {
      const e = out.get(l.id)!;
      e.at = Math.max(e.at, l.at);
    }
  }
  return [...out.values()].sort((a, b) => b.at - a.at);
}

export function PreviewHome() {
  const [input, setInput] = useState("");
  const [rows, setRows] = useState<DbRow[]>([]);
  const id = useMemo(() => parsePreviewInput(input), [input]);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}api/preview/list`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  const entries = useMemo(() => mergeEntries(rows), [rows]);
  const href = (pid: string) => `${import.meta.env.BASE_URL}preview/${encodeURIComponent(pid)}`;

  return (
    <div className="min-h-dvh flex flex-col items-center px-6 pt-[18vh] relative" style={{ background: "var(--bg)" }}>
      <a
        href={import.meta.env.BASE_URL}
        className="mono text-xs absolute top-4 left-4"
        style={{ color: "var(--tan-3)" }}
      >
        ← back
      </a>
      <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--tan)" }}>
        Preview Fork of the Sky Ecosystem Atlas
      </h1>
      <p className="text-sm mb-6 text-center max-w-xl" style={{ color: "var(--tan-3)" }}>
        Review trusted forks of Atlas. Trust based on previous merge history into
        sky-ecosystem/next-gen-atlas repo.
      </p>
      <form
        className="flex gap-2 w-full max-w-xl"
        onSubmit={(e) => {
          e.preventDefault();
          if (id) window.location.href = href(id);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste a next-gen-atlas PR, branch, or fork URL — or pull-256, owner:branch, a commit sha…"
          className="flex-1 px-3 py-2 rounded mono text-sm"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--tan)" }}
          autoFocus
        />
        <button
          type="submit"
          disabled={!id}
          className="px-4 py-2 rounded mono text-sm disabled:opacity-40"
          style={{ background: "var(--hover)", border: "1px solid var(--accent)", color: "var(--tan)" }}
        >
          Preview
        </button>
      </form>
      {input && !id && (
        <p className="mono text-xs mt-2" style={{ color: "var(--red)" }}>
          Can't parse that — try a github.com/…/next-gen-atlas URL, pull-N, owner:branch, or a 40-hex sha.
        </p>
      )}

      {entries.length > 0 && (
        <section className="w-full max-w-xl mt-10">
          <h2 className="mono text-xs mb-3" style={{ color: "var(--tan-3)" }}>
            my recent previews · {entries.length}
          </h2>
          <ul>
            {entries.map((e) => (
              <li key={e.id} className="border-b" style={{ borderColor: "var(--border)" }}>
                <a href={href(e.id)} className="flex items-baseline gap-3 py-2 px-1 hover:bg-hover rounded">
                  <span className="mono text-sm shrink-0" style={{ color: "var(--accent)" }}>{e.id}</span>
                  {e.title && <span className="text-sm truncate" style={{ color: "var(--tan)" }}>{e.title}</span>}
                  <span className="mono text-[10px] ml-auto shrink-0" style={{ color: "var(--tan-3)" }}>{e.detail}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
      <a href={import.meta.env.BASE_URL} className="mono text-xs mt-10" style={{ color: "var(--tan-3)" }}>
        ← live atlas
      </a>
    </div>
  );
}
