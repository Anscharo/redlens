import { PRE_MD_HTML_URL } from "./HistoryDisclaimers";

// Shown on the #117 migration entry of a doc with NO reconstructed pre-#117 entries of its
// own. `seam` is the reconstruction's verdict for the doc (src/lib/history.ts) and decides
// what we're allowed to say about it. Only "created" asserts a birth — a reviewed finding
// that the pre-migration HTML holds no earlier version. The default is the honest one: the
// seam matcher couldn't attach the doc to a pre-migration entry, which is a limit of the
// reconstruction, not a fact about the document, so the copy must never read as "created
// here" (the mistake this component exists to stop).
const HEADLINE: Record<string, string> = {
  created: "Introduced at the markdown migration.",
  split: "Carved out of a larger document at the markdown migration.",
};
const BODY: Record<string, string> = {
  created: "Review of the pre-migration HTML found no earlier version of this document.",
  split:
    "Its text lived inside a bigger pre-migration document, so its earlier history is recorded on the document it was extracted from.",
};
const UNTRACED_HEADLINE = "This document’s history before the markdown migration could not be traced.";
const UNTRACED_BODY =
  "Before 'Migrate To Markdown File' the atlas was maintained as a single HTML file with no per-document identities, and no pre-migration entry could be matched to this one — so its earlier history, if any, is unknown. This is not a finding that the document was created here.";

export function SeamFooter({ seam }: { seam?: string }) {
  const headline = (seam && HEADLINE[seam]) || UNTRACED_HEADLINE;
  const body = (seam && BODY[seam]) || UNTRACED_BODY;
  return (
    <p
      className="mono text-[11px] px-2 py-2.5 leading-snug"
      style={{ color: "var(--tan-3)", border: "2px solid var(--border)" }}
    >
      <strong style={{ color: "var(--tan-2)" }}>{headline}</strong> {body} 79 prior commits exist in
      the vendor repo —{" "}
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
