import type { CensusMember } from "../../lib/conceptsCensus";
import { Link } from "../Link";
import { atlasHref } from "../../lib/routes";

// The expandable member list under a ConceptCensus block — split out to keep
// ConceptCensus.tsx under the ~150-line convention. Layout follows
// LibraryGlossary.tsx (term list): compact rows, each deep-linking into the
// reader via atlasHref.
export function ConceptCensusMembers({ members }: { members: CensusMember[] }) {
  if (members.length === 0) {
    return <p className="text-xs mono text-tan-3">no members</p>;
  }
  return (
    <ul className="mt-2 space-y-1 max-h-80 overflow-y-auto">
      {members.map((m) => (
        <li key={m.uuid} className="text-xs flex items-center gap-2">
          <Link to={atlasHref(m.uuid)} className="mono link-accent">
            {m.doc_no}
          </Link>
          <span style={{ color: "var(--tan-2)" }}>{m.title}</span>
          {m.bucket && (
            <span className="mono text-[10px] px-1 rounded" style={{ color: "var(--tan-3)", border: "1px solid var(--border)" }}>
              {m.bucket}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
