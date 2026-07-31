import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { HistoryProvenance } from "./provenance/HistoryProvenance";

type Stage = { label: string; description: string; powers: string[] };

const STAGES: Stage[] = [
  {
    label: "parse atlas",
    description:
      "Reads the atomized document.md files in the upstream next-gen-atlas repository and turns their headings, UUIDs, types, links, and content into structured records.",
    powers: [
      "Atlas reader and breadcrumbs",
      "Full-content MiniSearch index",
      "Definitions glossary",
    ],
  },
  {
    label: "derive relationships",
    description:
      "Applies documented, pattern-based extractors to Atlas text. It identifies entities, roles, instances, document relationships, and address annotations; these are interpretations produced by RedLens, not extra claims from the Atlas.",
    powers: [
      "Constellations graph",
      "Cross-document reports",
      "Graph-aware search and chat tools",
    ],
  },
  {
    label: "enrich addresses",
    description:
      "Combines addresses and context found in the Atlas with Sky Chainlog labels and Etherscan verified-contract metadata. Atlas-derived and on-chain fields remain separate until they are merged for display.",
    powers: [
      "Address labels, roles, aliases, and explorer links",
      "Proxy and implementation metadata",
    ],
  },
  {
    label: "snapshot chain state",
    description:
      "Calls no-argument view functions through an Ethereum public RPC and records the exact block used. This is a point-in-time observation, not a live value or an Atlas statement.",
    powers: [
      "Cached contract values on address cards",
      "A block-linked snapshot in the footer",
    ],
  },
  {
    label: "assemble history",
    description:
      "Builds native history from the upstream git log and GitHub pull-request metadata, then adds the separately identified reconstructed eras described below.",
    powers: [
      "Per-document change timelines",
      "Commit, pull request, and original-source links",
    ],
  },
  {
    label: "publish & verify",
    description:
      "Produces versioned artifacts and checksums. The Atlas worker syncs documents, relationships, addresses, history, and optional embeddings to Postgres; the app rebuilds its in-memory indexes when the recorded Atlas SHA changes.",
    powers: [
      "SHA-keyed live and preview data",
      "Reproducibility and artifact-integrity checks",
    ],
  },
];

function PipelineStage({ stage, index }: { stage: Stage; index: number }) {
  return (
    <section className="mb-8">
      <h2 className="flex items-baseline gap-3 mb-2">
        <span className="mono text-xs text-tan-3 w-4">{index + 1}.</span>
        <span className="mono text-xs text-tan-3 uppercase tracking-wider">
          {stage.label}
        </span>
      </h2>
      <div className="pl-7 space-y-2">
        <p className="text-xs" style={{ color: "var(--tan-2)" }}>
          {stage.description}
        </p>
        <div className="flex gap-4">
          <span className="mono text-xs text-tan-3 w-14 shrink-0">powers</span>
          <ul
            className="space-y-1 flex-1 text-xs"
            style={{ color: "var(--tan-2)" }}
          >
            {stage.powers.map((power) => (
              <li key={power}>· {power}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function ProvenancePage() {
  useDocumentTitle("Provenance: Sky Atlas by Redline");
  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">
      <article className="max-w-3xl mx-auto">
        <header>
          <p className="mono text-xs text-tan-3 mb-1">provenance</p>
          <h1
            className="text-xl font-semibold mb-4"
            style={{ color: "var(--tan)" }}
          >
            Data flow &amp; provenance
          </h1>
          <p className="text-sm mb-4" style={{ color: "var(--tan-2)" }}>
            The current Atlas text comes from the sky-ecosystem/next-gen-atlas
            git repository. RedLens also uses clearly separated supporting
            sources: its git and GitHub pull-request history, Sky Chainlog,
            Etherscan verified-contract metadata, a public Ethereum RPC, and the
            historical sources documented below.
          </p>
          <p className="text-sm mb-8" style={{ color: "var(--tan-2)" }}>
            RedLens-derived graphs, labels, reports, search indexes, and
            summaries are transformations of those sources—not independent
            primary records. Builds are pinned to an Atlas commit, and shipping
            artifacts are checksummed so the inputs and output version can be
            audited.
          </p>
        </header>
        <p className="text-xs mb-4" style={{ color: "var(--tan-3)" }}>
          The data flow has {STAGES.length} stages:
        </p>
        {STAGES.map((stage, index) => (
          <PipelineStage key={stage.label} stage={stage} index={index} />
        ))}
        <HistoryProvenance />
      </article>
    </div>
  );
}
