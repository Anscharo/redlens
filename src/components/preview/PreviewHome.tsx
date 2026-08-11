import { useEffect, useMemo, useState } from "react";
import { parsePreviewInput, localPreviews } from "../../lib/previewLocal";
import { initAnalytics, register, track, pageview } from "../../lib/analytics";
import { ProfileButton } from "../chat/ProfileButton";
import { usersEnabled } from "../../lib/usersEnabled";
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

// Private-repo input → the `owner:repo:branch` preview-id grammar (branch `/`
// encoded as `~`; the sentinel `HEAD` means "the repo's default branch", which
// the server resolves). Accepts, in order:
//   - a full github.com URL, scheme optional, .git optional:
//       github.com/OWNER/REPO                 → default branch
//       github.com/OWNER/REPO/tree/BRANCH     → BRANCH (may contain /)
//   - OWNER/REPO@BRANCH                        → BRANCH
//   - OWNER/REPO                               → default branch
function parsePrivateInput(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const mk = (owner: string, repo: string, ref: string) => `${owner}:${repo}:${ref.replaceAll("/", "~")}`;

  const url = s.match(/github\.com\/([\w.-]+)\/([^/\s]+?)(?:\.git)?(?:\/(.*))?$/i);
  if (url) {
    const [, owner, repo, rest = ""] = url;
    if (!rest || rest === "/") return mk(owner, repo, "HEAD");
    const tree = rest.match(/^tree\/(.+?)\/?$/);
    return tree ? mk(owner, repo, decodeURIComponent(tree[1])) : null;
  }
  // URL-shaped but not a github.com repo URL — don't fall through to the id forms.
  if (/^https?:\/\/|github\.com/i.test(s)) return null;

  const at = s.match(/^([\w.-]+)\/([\w.-]+)@(.+)$/);
  if (at) return mk(at[1], at[2], at[3]);
  const bare = s.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (bare) return mk(bare[1], bare[2], "HEAD");
  return null;
}

export function PreviewHome() {
  const [input, setInput] = useState("");
  const [privateInput, setPrivateInput] = useState("");
  const [rows, setRows] = useState<DbRow[]>([]);
  const id = useMemo(() => parsePreviewInput(input), [input]);
  const privateId = useMemo(() => parsePrivateInput(privateInput), [privateInput]);

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
      {usersEnabled() && (
        <div className="absolute top-4 right-4">
          <ProfileButton />
        </div>
      )}
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

      {usersEnabled() && (
        <section className="w-full max-w-xl mt-8 pt-6 border-t" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-sm font-semibold mb-1" style={{ color: "var(--tan)" }}>
            Preview a private repo
          </h2>
          <p className="mono text-xs mb-3" style={{ color: "var(--tan-3)" }}>
            You'll need GitHub access to the repo, and the RedLens app installed on it.
          </p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              track("preview_submit", {
                product: "preview",
                input: privateInput,
                parsed_id: privateId,
                parsed: !!privateId,
                private: true,
              });
              if (privateId) window.location.href = `${import.meta.env.BASE_URL}preview/${encodeURIComponent(privateId)}`;
            }}
          >
            <input
              value={privateInput}
              onChange={(e) => setPrivateInput(e.target.value)}
              placeholder="github.com/owner/repo — or …/tree/branch, owner/repo@branch"
              className="flex-1 px-3 py-2 rounded mono text-sm"
              style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--tan)" }}
            />
            <button
              type="submit"
              disabled={!privateId}
              className="px-4 py-2 rounded mono text-sm disabled:opacity-40"
              style={{ background: "var(--hover)", border: "1px solid var(--accent)", color: "var(--tan)" }}
            >
              Preview private repo
            </button>
          </form>
          {privateInput && !privateId && (
            <p className="mono text-xs mt-2" style={{ color: "var(--red)" }}>
              Paste a github.com/owner/repo URL (optionally /tree/branch), or owner/repo@branch.
            </p>
          )}
        </section>
      )}

      <PreviewPrTabs entries={entries} />
      <a href={import.meta.env.BASE_URL} className="mono text-xs mt-10" style={{ color: "var(--tan-3)" }}>
        ← live atlas
      </a>
    </div>
  );
}
