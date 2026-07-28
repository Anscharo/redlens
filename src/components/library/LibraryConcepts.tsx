import conceptsRaw from "../../../docs/library/concepts.md?raw";
import auditRaw from "../../../docs/library/concepts-audit.md?raw";
import { LibraryMarkdown } from "./LibraryMarkdown";

// Curated research docs, bundled at build time (they ship with deploys, not
// atlas commits — see docs/plans/atlas-library.md "curated flesh").
export function LibraryConcepts() {
  return (
    <div>
      <p className="mono text-xs text-tan-3 uppercase tracking-wider mb-2">
        Cross-cutting concept catalog · live census data from the checked-out atlas
      </p>
      <LibraryMarkdown raw={conceptsRaw} sticky />
    </div>
  );
}

// The audit/triage plan for the concept catalog — which sections are
// byte-grounded vs agent-derived, and what gets scrutinized or rewritten.
export function LibraryAudit() {
  return <LibraryMarkdown raw={auditRaw} />;
}
