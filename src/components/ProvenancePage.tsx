import { useDocumentTitle } from "../hooks/useDocumentTitle";

type Stage = {
  label: string;
  description: string;
  powers: string[];
};

const STAGES: Stage[] = [
  {
    label: "parse",
    description:
      "Reads Sky Atlas.md and extracts every heading into a structured node record with a UUID, doc number, type, depth, and full content. Also builds a full-text search index over the entire corpus.",
    powers: [
      "Full-text search (MiniSearch in a Web Worker)",
      "Document viewing — every atlas node page, breadcrumbs, and UUID-to-UUID linking",
    ],
  },
  {
    label: "enrich addresses",
    description:
      "Collects every on-chain address mentioned in the atlas, then enriches each one from the Sky chainlog and Etherscan. Results are cached so contributors don't need an API key.",
    powers: [
      "Address cards in the annotations panel (entity labels, roles, aliases, explorer links)",
      "In-content address linkification",
    ],
  },
  {
    label: "snapshot chain state",
    description:
      "Reads view-function values for known contracts via a public RPC and pins the results to a specific block. No keys required — the snapshot is committed and reproducible.",
    powers: [
      "Cached on-chain view-function values shown on address cards",
      "Block pill in the footer — click through to the exact block on Etherscan",
    ],
  },
  {
    label: "atlas history",
    description:
      "Walks the upstream atlas commit history and matches each change to the affected nodes by heading overlap. GitHub PR metadata is also matched where available.",
    powers: [
      "Per-document change timeline — toggle history on any atlas page",
      "Upstream commit and PR links for every change entry",
    ],
  },
  {
    label: "build graph",
    description:
      "Extracts typed relationships from the atlas text — document structure, agent roles, governance parties, instances, and on-chain addresses — and emits a graph used by the Constellations view and reports.",
    powers: [
      "Constellations — visual graph of agents, facilitators, governance parties, and their relationships",
      "Graph-aware search and reports that join across the Sky ecosystem",
    ],
  },
];

export function ProvenancePage() {
  useDocumentTitle("Provenance: Sky Atlas by Redline");
  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">provenance</p>
        <h1 className="text-xl font-semibold mb-4" style={{ color: "var(--tan)" }}>
          Data flow &amp; provenance
        </h1>
        <p className="text-sm mb-8" style={{ color: "var(--tan-2)" }}>
          Everything in this app derives from a single source:{" "}
          <span className="mono">Sky&nbsp;Atlas.md</span>, published by sky-ecosystem. A pipeline of
          build scripts runs at each release, extracting structured data from the Atlas and
          publishing artifacts the UI reads at runtime. Everything is reproducible from a single{" "}
          <span className="mono">pnpm build</span>. For more detail, see the README.
        </p>

        <p className="text-xs mb-4" style={{ color: "var(--tan-3)" }}>
          The pipeline runs {STAGES.length} stages in order:
        </p>

        {STAGES.map((s, i) => (
          <section key={s.label} className="mb-8">
            <div className="flex items-baseline gap-3 mb-2">
              <span className="mono text-xs text-tan-3 w-4">{i + 1}.</span>
              <span className="mono text-xs text-tan-3 uppercase tracking-wider">{s.label}</span>
            </div>
            <div className="pl-7 space-y-2">
              <p className="text-xs" style={{ color: "var(--tan-2)" }}>
                {s.description}
              </p>
              <div className="flex gap-4">
                <span className="mono text-xs text-tan-3 w-14 shrink-0">powers</span>
                <ul className="space-y-1 flex-1 text-xs" style={{ color: "var(--tan-2)" }}>
                  {s.powers.map((p) => (
                    <li key={p}>· {p}</li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
