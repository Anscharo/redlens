import { Fragment, useEffect, useState } from "react";
import { loadHistory, type HistoryEntry } from "../../lib/history";
import { EntryRow } from "./EntryRow";

// Before PR #117 (commit 22cc27b5, 2025-11-21) the atlas was a single HTML file
// with no per-doc identities. Two cases:
//  · reconstructed — the pre-#117 per-doc history is now threaded into atlas_history
//    (era="html"); hidden by default behind the "View HTML Era Edits" toggle, with a
//    disclaimer shown before those entries (the diffs are translated + lineage-traced,
//    so approximate).
//  · not reconstructed — a doc created AT the migration (no era="html" entries); keep
//    the legacy one-line footer pointing at the last pre-migration HTML file.
const PRE_MD_PR = 117;
// 7b43d159 is the last commit before the migration (22cc27b5) — the HTML file's
// content right before the switch to markdown.
const PRE_MD_HTML_URL =
  "https://github.com/sky-ecosystem/next-gen-atlas/blob/7b43d159e098b30e67c4be6a7594a237a340fa58/Sky%20Atlas/Sky%20Atlas.html";

// The provenance disclaimer for reconstructed HTML-era entries. Names the methods we
// used to trace each document's lineage across the 79 pre-#117 HTML commits.
function HtmlEraDisclaimer() {
  return (
    <div
      className="mono text-[10px] px-2 py-2.5 leading-snug my-1"
      style={{ color: "var(--tan-3)", border: "2px solid var(--border)" }}
    >
      <strong style={{ color: "var(--tan-2)" }}>Pre-#117 history is reconstructed.</strong>{" "}
      Before the “Migrate To Markdown File” PR (Nov 2025) the Atlas was a single HTML file
      with no per-document identities. The entries below were automatically translated from
      the original HTML tables to markdown, and each document’s lineage was traced by{" "}
      <span style={{ color: "var(--tan-2)" }}>deterministic matching</span> (content + structure
      fingerprints),{" "}
      <span style={{ color: "var(--tan-2)" }}>AI cross-checks</span> using multiple AI models
      forward and backward looking of changes, PR descriptions for each change, and{" "}
      <span style={{ color: "var(--tan-2)" }}>human review</span> on top; although thorough the
      possibility for mistakes exists.{" "}
      <a
        href={PRE_MD_HTML_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline focus-visible:underline"
        style={{ color: "var(--accent)" }}
      >
        view original HTML →
      </a>
    </div>
  );
}

function PreMdFooter() {
  return (
    <p
      className="mono text-[10px] px-2 py-2.5 leading-snug"
      style={{ color: "var(--tan-3)", border: "2px solid var(--border)" }}
    >
      Before 'Migrate To Markdown File' the atlas was maintained as a single HTML file. 79 prior commits exist in the vendor repo —{" "}
      <a
        href={PRE_MD_HTML_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline focus-visible:underline"
        style={{ color: "var(--accent)" }}
      >
        view original HTML →
      </a>
    </p>
  );
}

export function NodeHistory({ nodeId }: { nodeId: string }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(undefined as unknown as null);
  const [loading, setLoading] = useState(true);
  const [showHtmlEra, setShowHtmlEra] = useState(false);

  useEffect(() => {
    setLoading(true);
    setEntries(null);
    setShowHtmlEra(false);
    loadHistory(nodeId).then((data) => {
      setEntries(data);
      setLoading(false);
    });
  }, [nodeId]);

  if (loading) {
    return (
      <p className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>
        loading history…
      </p>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <p className="mono text-[10px]" style={{ color: "var(--tan-3)" }}>
        no history recorded
      </p>
    );
  }

  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  const hasHtmlEra = sorted.some((e) => e.era === "html");
  // Reconstructed HTML-era entries are hidden until the toggle is on. When shown, they
  // sort to the bottom (oldest); the disclaimer appears once, right before the first of
  // them, so it introduces that section. The legacy footer only applies when nothing was
  // reconstructed at all (docs created at the migration), regardless of the toggle.
  const visible = showHtmlEra ? sorted : sorted.filter((e) => e.era !== "html");
  const firstHtmlEra = visible.findIndex((e) => e.era === "html");

  return (
    <div>
      {hasHtmlEra && (
        <button
          type="button"
          aria-pressed={showHtmlEra}
          onClick={() => setShowHtmlEra((v) => !v)}
          className="mono text-[10px] uppercase tracking-wide px-2 py-1 mb-2 rounded"
          style={{
            color: showHtmlEra ? "var(--bg)" : "var(--accent)",
            background: showHtmlEra ? "var(--accent)" : "transparent",
            border: "1px solid var(--accent)",
          }}
        >
          {showHtmlEra ? "Hide HTML Era Edits" : "View HTML Era Edits"}
        </button>
      )}
      {visible.map((entry, i) => (
        <Fragment key={i}>
          {i === firstHtmlEra && <HtmlEraDisclaimer />}
          <EntryRow entry={entry} />
          {!hasHtmlEra && entry.pr === PRE_MD_PR && <PreMdFooter />}
        </Fragment>
      ))}
    </div>
  );
}
