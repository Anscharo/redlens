import { Fragment, useEffect, useState } from "react";
import { loadHistory, type HistoryEntry } from "../../lib/history";
import { EntryRow } from "./EntryRow";

// Before PR #117 (commit 22cc27b5, 2025-11-21) the atlas was a single HTML
// file with no per-doc identities. Surface the prior history as a one-line
// footer under the migration entry on docs that have it.
const PRE_MD_PR = 117;
const PRE_MD_COMPARE_URL =
  "https://github.com/sky-ecosystem/next-gen-atlas/compare/4e931dfd...22cc27b5";

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

  return (
    <div>
      {sorted.map((entry, i) => (
        <Fragment key={i}>
          <EntryRow entry={entry} />
          {entry.pr === PRE_MD_PR && <PreMdFooter />}
        </Fragment>
      ))}
    </div>
  );
}
