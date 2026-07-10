import { useEffect, useMemo, useState } from "react";
import { parsePreviewInput, localPreviews } from "../../lib/previewLocal";
import { initAnalytics, register, track, pageview } from "../../lib/analytics";
import { PreviewPrTabs } from "./PreviewPrTabs";
import type { Entry } from "./types";

// /preview index: paste a PR / branch / fork URL (or id) → generate a preview;
// below, "my recent previews" — strictly the INTERSECTION of what this browser
// has opened (localStorage) and what is live in the DB (GET /api/preview/list).
// Local-only entries (DB wiped / sha blocked) and DB-only entries (other
// people's previews) are both hidden.

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

function mergeEntries(rows: DbRow[]): Entry[] {
  const bySha = new Map(rows.map((r) => [r.sha, r]));
  const out = new Map<string, Entry>();
  for (const l of localPreviews()) {
    const db = bySha.get(l.sha);
    if (!db) continue; // AND-semantics: must still be live in the DB
    const prev = out.get(l.id);
    if (prev) {
      prev.at = Math.max(prev.at, l.at);
      continue;
    }
    out.set(l.id, {
      id: l.id,
      title: db.pr_title ?? undefined,
      detail: [db.pr_author && `by ${db.pr_author}`, db.pr_state && db.pr_state !== "open" && db.pr_state, `${db.doc_count} docs`]
        .filter(Boolean)
        .join(" · "),
      at: l.at,
    });
  }
  return [...out.values()].sort((a, b) => b.at - a.at);
}

export function PreviewHome() {
  const [input, setInput] = useState("");
  const [rows, setRows] = useState<DbRow[]>([]);
  const id = useMemo(() => parsePreviewInput(input), [input]);

  // PreviewHome renders outside App/Router, so usePageAnalytics never runs here —
  // initialise analytics and tag this surface as the "preview" product ourselves.
  useEffect(() => {
    initAnalytics();
    register({ product: "preview" });
    pageview(window.location.pathname + window.location.search);
  }, []);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}api/preview/list`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  const entries = useMemo(() => mergeEntries(rows), [rows]);

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
          // Capture what was entered — including inputs that fail to parse, which
          // reveal what people expect the box to accept. product is set above.
          track("preview_submit", { product: "preview", input, parsed_id: id, parsed: !!id });
          if (id) window.location.href = `${import.meta.env.BASE_URL}preview/${encodeURIComponent(id)}`;
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

      <PreviewPrTabs entries={entries} />
      <a href={import.meta.env.BASE_URL} className="mono text-xs mt-10" style={{ color: "var(--tan-3)" }}>
        ← live atlas
      </a>
    </div>
  );
}
