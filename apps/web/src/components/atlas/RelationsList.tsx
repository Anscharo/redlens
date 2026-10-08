import { SECTION_HEAD, relationEnd, type Nav, type PanelRelation } from "./panelSections";

interface RelationsListProps {
  relations: PanelRelation[];
  onNav: Nav;
  onNavDoc: Nav;
}

// The notes section's extracted relations, both directions.
export function RelationsList({ relations, onNav, onNavDoc }: RelationsListProps) {
  return (
    <div className="mt-8">
      <p className={`${SECTION_HEAD} mb-3`}>relations · {relations.length}</p>
      <div className="space-y-2">
        {relations.map((rel, i) => (
          <RelationRow key={i} rel={rel} onNav={onNav} onNavDoc={onNavDoc} />
        ))}
      </div>
    </div>
  );
}

// One relation: its kind, an inbound arrow, the far end (a link when it has a doc),
// and the doc_nos that define it.
function RelationRow({ rel, onNav, onNavDoc }: { rel: PanelRelation; onNav: Nav; onNavDoc: Nav }) {
  const { edge: e, isOut } = rel;
  const { label, navId } = relationEnd(rel);
  return (
    <div className="text-xs pb-2 border-b border-border">
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <span className="mono px-1.5 py-0.5 rounded text-[10px] bg-surface text-accent">{e.e}</span>
        {!isOut && <span className="text-[10px] mono text-gray">←</span>}
        {navId ? (
          <button className="mono hover:underline text-left text-tan-2" onClick={() => onNav("relation", navId)}>{label}</button>
        ) : (
          <span className="font-medium text-tan">{label}</span>
        )}
      </div>
      {e.s && e.s.length > 0 && (
        <p className="mono text-[10px] text-tan-3">
          defined in:{" "}
          {e.s.map((docNo, j) => (
            <span key={docNo}>
              {j > 0 && ", "}
              <button onClick={() => onNavDoc("relation_source", docNo)} className="hover:underline text-accent">{docNo}</button>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
