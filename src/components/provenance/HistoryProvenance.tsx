const linkClass = "hover:underline focus-visible:underline";

export function HistoryProvenance() {
  return (
    <section
      aria-labelledby="history-provenance"
      className="mt-12 border-t pt-8"
      style={{ borderColor: "var(--border)" }}
    >
      <h2
        id="history-provenance"
        className="text-lg font-semibold mb-6"
        style={{ color: "var(--tan)" }}
      >
        History provenance
      </h2>

      <section
        id="reconstructed-history"
        className="mb-10"
        style={{ scrollMarginTop: "64px" }}
      >
        <h3 className="mono text-xs text-tan-3 uppercase tracking-wider mb-3">
          The HTML era: reconstructed document history
        </h3>
        <div className="space-y-3 text-xs" style={{ color: "var(--tan-2)" }}>
          <p>
            <strong>History before pull request #117 is reconstructed.</strong>{" "}
            Before “Migrate To Markdown File” on 21 November 2025, the Atlas was
            maintained as one HTML file. Git preserved each whole-file revision,
            but the HTML tables did not give individual documents the stable
            UUID identities used today. Git can therefore prove what the file
            looked like at each commit, but it cannot directly say that a row in
            one revision is the same document as a renamed, moved, split, or
            edited row in another.
          </p>
          <p>
            RedLens translated all 79 preserved HTML revisions into a common
            markdown-shaped representation, seeded present-day identities at the
            migration boundary, and traced each lineage backward. Automatic
            matching compares normalized content and structural fingerprints.
            Ambiguous matches were checked in both chronological directions,
            against pull-request titles and descriptions, and with multiple AI
            models; deterministic agreements and model suggestions were then
            subjected to human review. A second independent model audit,
            forward-versus-backward tracing, and cross-agent consistency checks
            were used to find disagreements.
          </p>
          <p>
            The reconstruction and its decisions are frozen, reviewed artifacts,
            so they can be reproduced and audited rather than changing at
            runtime. This process is thorough, but it is still an attribution
            layer over whole-file history. Renames, near-duplicate text, large
            rewrites, splits, and merges can create uncertainty, and mistakes
            remain possible. Treat the linked original commit or pull request as
            primary evidence for the change; treat its assignment to a
            present-day document as RedLens’s reconstruction.
          </p>
          <p>
            <a
              href="https://github.com/sky-ecosystem/next-gen-atlas/blob/7b43d159e098b30e67c4be6a7594a237a340fa58/Sky%20Atlas/Sky%20Atlas.html"
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
              style={{ color: "var(--accent)" }}
            >
              View the last pre-migration HTML file{" "}
              <span className="enlargen">→</span>
            </a>
          </p>
        </div>
      </section>

      <section id="pre-git-history" style={{ scrollMarginTop: "64px" }}>
        <h3 className="mono text-xs text-tan-3 uppercase tracking-wider mb-3">
          Before the current git repository
        </h3>
        <div className="space-y-3 text-xs" style={{ color: "var(--tan-2)" }}>
          <p>
            The current repository begins on 28 May 2025. Earlier entries are
            origin evidence, not a continuous changelog. RedLens works backward
            from the first git snapshot using a recovered Atlas v2 genesis
            snapshot dated 2 September 2024, six preserved Atlas v1/MIP-era
            source artifacts, and accepted Atlas Edit Proposals where a proposal
            can be tied to a document.
          </p>
          <p>
            Matching the genesis snapshot to later documents uses the same
            lineage threading as the HTML-era reconstruction, plus content and
            structure corroboration. MIP-era attribution uses calibrated
            text-containment matching and preserved section dates. A small
            curated set of accepted AEPs replaces otherwise-undated placeholders
            with dated, linked evidence. Ambiguous cases are deliberately left
            without an origin claim rather than guessed.
          </p>
          <p>
            These sources can establish that wording was present in a historical
            snapshot or proposal, and can show that some documents remained
            unchanged across an interval. They generally cannot recover every
            intermediate edit, author, reason, or exact date. An entry labelled
            “severed” means only that the document appeared during the
            unrecorded interval between known snapshots. For edits in this era,
            the Sky Forum and governance proposals may provide context, but
            forum discussion is not treated as proof of an Atlas change unless
            the displayed entry links a specifically accepted source.
          </p>
          <p>
            <a
              href="https://github.com/sky-ecosystem/mips"
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
              style={{ color: "var(--accent)" }}
            >
              Browse the historical MIPs repository{" "}
              <span className="enlargen">→</span>
            </a>
          </p>
        </div>
      </section>
    </section>
  );
}
