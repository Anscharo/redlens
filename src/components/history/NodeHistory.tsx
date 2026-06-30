import { Fragment, useEffect, useState } from "react";
import { loadHistory, type HistoryEntry } from "../../lib/history";
import { EntryRow } from "./EntryRow";

// Before PR #117 (commit 22cc27b5, 2025-11-21) the atlas was a single HTML file
// with no per-doc identities. Two cases:
//  · reconstructed — the pre-#117 per-doc history is now threaded into atlas_history
//    (era="html"); surface a disclaimer before those entries (the diffs are translated
//    + lineage-traced, so approximate).
//  · not reconstructed — a doc created AT the migration (no era="html" entries); keep
//    the legacy one-line footer pointing at the raw vendor-repo compare.
const PRE_MD_PR = 117;
const PRE_MD_COMPARE_URL =
  "https://github.com/sky-ecosystem/next-gen-atlas/compare/4e931dfd...22cc27b5";

// The provenance disclaimer for reconstructed HTML-era entries. Names the methods we
// used to trace each document's lineage across the 79 pre-#117 HTML commits.
function HtmlEraDisclaimer() {
  return (
    <div
      className="mono text-[10px] px-2 py-2.5 leading-snug my-1"
      style={{ color: "var(--tan-3)", border: "2px solid var(--border)" }}
    >
      <strong style={{ color: "var(--tan-2)" }}>Pre-#117 history is reconstructed.</strong>{" "}
      Before the “Migrate To Markdown File” migration (Nov 2025) the atlas was a single HTML
      file with no per-document identities. The entries below were automatically translated
      from the original HTML tables to markdown, and each document’s lineage was traced by{" "}
      <span style={{ color: "var(--tan-2)" }}>deterministic matching</span> (content + structure
      fingerprints; two independent algorithms must agree),{" "}
      <span style={{ color: "var(--tan-2)" }}>AI cross-checks</span> (an AI model on the
      ambiguous cases, only when it agrees with an algorithm), and{" "}
      <span style={{ color: "var(--tan-2)" }}>human review</span> for the rest — so these diffs
      are approximate.{" "}
      <a
        href={PRE_MD_COMPARE_URL}
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
        href={PRE_MD_COMPARE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline focus-visible:underline"
        style={{ color: "var(--accent)" }}
      >
        view HTML-era diff →
      </a>
    </p>
  );
}

export function NodeHistory({ nodeId }: { nodeId: string }) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(undefined as unknown as null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setEntries(null);
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
  // Reconstructed HTML-era entries sort to the bottom (oldest); show the disclaimer
  // once, right before the first of them, so it introduces that section. Fall back to
  // the legacy footer only when nothing was reconstructed (docs created at the migration).
  const firstHtmlEra = sorted.findIndex((e) => e.era === "html");

  return (
    <div>
      {sorted.map((entry, i) => (
        <Fragment key={i}>
          {i === firstHtmlEra && <HtmlEraDisclaimer />}
          <EntryRow entry={entry} />
          {firstHtmlEra < 0 && entry.pr === PRE_MD_PR && <PreMdFooter />}
        </Fragment>
      ))}
    </div>
  );
}
