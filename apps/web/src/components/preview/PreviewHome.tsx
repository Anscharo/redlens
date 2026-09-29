import { useEffect, useMemo, useState } from "react";
import { parsePreviewInput, parsePrivateInput, isPrivatePrId, localPreviews, type LocalPreview } from "../../lib/previewLocal";
import { mergeRecentPreviews, type MineRow } from "../../lib/previewRecent";
import { initAnalytics, register, track, pageview } from "../../lib/analytics";
import { ProfileButton } from "../chat/ProfileButton";
import { useAuth } from "../chat/auth";
import { usersEnabled } from "../../lib/usersEnabled";
import { PreviewPrTabs } from "./PreviewPrTabs";

// /preview index: paste a PR / branch / fork URL (or id) → generate a preview;
// below, "my recent previews", from GET /api/preview/mine — never the public
// /list, which excludes every private row by design and so silently dropped
// every private-repo preview the visitor had legitimately opened.
//
// Signed in, the list is the ACCOUNT's: the server records each open and answers
// with them, so the history follows the person to their next browser. We still
// send this browser's localStorage shas either way — they are the whole list for
// an anonymous visitor, and they cover what a signed-in one opened before the
// account history existed or while logged out. mergeRecentPreviews (lib/
// previewRecent.ts) folds the two together; a local entry the server can't
// confirm is still hidden, so a wiped DB or a blocked sha leaves no dead row.

export function PreviewHome() {
  const [input, setInput] = useState("");
  const [privateInput, setPrivateInput] = useState("");
  // Both halves of the recent list move together: the server rows and the exact
  // localStorage snapshot whose shas were sent for them. Keeping them in one
  // state is what stops the merge from pairing rows with a later snapshot.
  const [recent, setRecent] = useState<{ rows: MineRow[]; local: LocalPreview[] }>({ rows: [], local: [] });
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null; // the effect below depends on WHO, not on the user object's identity
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
    // Wait for the session probe so this asks once, knowing whether there is an
    // account history to include (authLoading is already false when logins are off).
    if (authLoading) return;
    const local = localPreviews();
    const shas = [...new Set(local.map((p) => p.sha))];
    if (shas.length === 0 && !userId) {
      // Nothing to ask about — and signing out lands here, so CLEAR rather than
      // return: the previous user's rows (private repo ids and titles among
      // them) must not stay on screen for whoever uses this browser next.
      setRecent({ rows: [], local: [] });
      return;
    }
    // `alive` drops a response whose request is no longer the current one: when
    // userId flips, the signed-in answer must not land after the signed-out one.
    let alive = true;
    fetch(`${import.meta.env.BASE_URL}api/preview/mine?shas=${shas.join(",")}`, { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => alive && setRecent({ rows: Array.isArray(d) ? d : [], local }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [authLoading, userId]);

  const entries = useMemo(() => mergeRecentPreviews(recent.rows, recent.local), [recent]);

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
            You'll need GitHub access to the repo, and the Sky Atlas by Redline GitHub App installed on it.
          </p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              // Private path: do NOT send the repo/branch identifier (input,
              // parsed_id) off-box — for a private repo those are sensitive, and
              // this fires before any access check. Coarse fields only.
              track("preview_submit", { product: "preview", parsed: !!privateId, private: true });
              if (privateId) window.location.href = `${import.meta.env.BASE_URL}preview/${encodeURIComponent(privateId)}`;
            }}
          >
            <input
              value={privateInput}
              onChange={(e) => setPrivateInput(e.target.value)}
              placeholder="github.com/owner/repo — or …/pull/N, …/tree/branch, owner/repo@branch"
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
          {privateId && (
            <p className="mono text-xs mt-2" style={{ color: "var(--tan-3)" }}>
              {isPrivatePrId(privateId)
                ? "will compare with the pull request's base branch"
                : "will compare with this repo's default branch, or with the live sky-ecosystem/next-gen-atlas:main when there is none to compare against"}
            </p>
          )}
          {privateInput && !privateId && (
            <p className="mono text-xs mt-2" style={{ color: "var(--red)" }}>
              Paste a github.com/owner/repo URL (optionally /pull/N or /tree/branch), or owner/repo@branch.
            </p>
          )}
        </section>
      )}

      <PreviewPrTabs entries={entries} accountScoped={!!user} />
      <a href={import.meta.env.BASE_URL} className="mono text-xs mt-10" style={{ color: "var(--tan-3)" }}>
        ← live atlas
      </a>
    </div>
  );
}
