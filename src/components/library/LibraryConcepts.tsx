import conceptsRaw from "../../../docs/library/concepts.md?raw";
import auditRaw from "../../../docs/library/concepts-audit.md?raw";
import { LibraryMarkdown } from "./LibraryMarkdown";

// Curated research docs, bundled at build time (they ship with deploys, not
// atlas commits — see docs/plans/atlas-library.md "curated flesh").
export function LibraryConcepts() {
  return <LibraryMarkdown raw={conceptsRaw} />;
}

// The audit/triage plan for the concept catalog — which sections are
// byte-grounded vs agent-derived, and what gets scrutinized or rewritten.
export function LibraryAudit() {
  return <LibraryMarkdown raw={auditRaw} />;
}
