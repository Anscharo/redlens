import { PRE_MD_HTML_URL } from "./HistoryDisclaimers";

// Shown on the #117 migration entry of a doc with NO reconstructed pre-#117 entries of its
// own. `seam` is the reconstruction's verdict for the doc (src/lib/history.ts) and decides
// what we're allowed to say about it. Only "created" asserts a birth — a reviewed finding
// that the pre-migration HTML holds no earlier version. The default is the honest one: the
// seam matcher couldn't attach the doc to a pre-migration entry, which is a limit of the
// reconstruction, not a fact about the document, so the copy must never read as "created
// here" (the mistake this component exists to stop). What each verdict means is explained
// once on the provenance page (provenance/HistoryProvenance.tsx, #untraced-history) rather
// than restated in full on every entry.
const HEADLINE: Record<string, string> = {
  created: "Introduced at the markdown migration.",
  split: "Carved out of a larger document at the markdown migration.",
};
const UNTRACED_HEADLINE = "This document’s history before the markdown migration could not be traced.";

export function SeamFooter({ seam }: { seam?: string }) {
  const headline = (seam && HEADLINE[seam]) || UNTRACED_HEADLINE;
  return (
    <p
      className="mono text-[11px] px-2 py-2.5 leading-snug"
      style={{ color: "var(--tan-3)", border: "2px solid var(--border)" }}
    >
      <strong style={{ color: "var(--tan-2)" }}>{headline}</strong>{" "}
      <a
        href="/provenance#untraced-history"
        className="hover:underline focus-visible:underline"
        style={{ color: "var(--accent)" }}
      >
        What this means <span className="enlargen">→</span>
      </a>{" "}
      79 prior commits exist in the vendor repo —{" "}
      <a
        href={PRE_MD_HTML_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:underline focus-visible:underline"
        style={{ color: "var(--accent)" }}
      >
        view original HTML <span className="enlargen">→</span>
      </a>
    </p>
  );
}
