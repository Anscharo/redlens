import conceptsRaw from "../../../../../docs/crossview/concepts.md?raw";
import auditRaw from "../../../../../docs/crossview/concepts-audit.md?raw";
import { CrossViewMarkdown } from "./CrossViewMarkdown";

// Curated research docs, bundled at build time (they ship with deploys, not
// atlas commits — see docs/plans/atlas-crossview.md "curated flesh").
export function CrossViewConcepts() {
  return (
    <div>
      <p className="mono text-xs text-tan-3 uppercase tracking-wider mb-2">
        Cross-cutting concept catalog · live census data from the checked-out atlas
      </p>
      <CrossViewMarkdown raw={conceptsRaw} sticky />
    </div>
  );
}

// The audit/triage plan for the concept catalog — which sections are
// byte-grounded vs agent-derived, and what gets scrutinized or rewritten.
export function CrossViewAudit() {
  return <CrossViewMarkdown raw={auditRaw} />;
}
