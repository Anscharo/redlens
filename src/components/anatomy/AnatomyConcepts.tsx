import conceptsRaw from "../../../docs/anatomy/concepts.md?raw";
import auditRaw from "../../../docs/anatomy/concepts-audit.md?raw";
import { AnatomyMarkdown } from "./AnatomyMarkdown";

// Curated research docs, bundled at build time (they ship with deploys, not
// atlas commits — see docs/plans/atlas-anatomy.md "curated flesh").
export function AnatomyConcepts() {
  return (
    <div>
      <p className="mono text-xs text-tan-3 uppercase tracking-wider mb-2">
        Cross-cutting concept catalog · live census data from the checked-out atlas
      </p>
      <AnatomyMarkdown raw={conceptsRaw} sticky />
    </div>
  );
}

// The audit/triage plan for the concept catalog — which sections are
// byte-grounded vs agent-derived, and what gets scrutinized or rewritten.
export function AnatomyAudit() {
  return <AnatomyMarkdown raw={auditRaw} />;
}
