import type { AtlasNode } from "@/types";
import type { CousinDoc } from "../../lib/cousins";
import type { EdgeResult } from "../../lib/graph";
import { RelatedDocList } from "./RelatedDocList";
import { RelationsList } from "./RelationsList";
import { SECTION_HEAD, type Nav, type PanelRelation } from "./panelSections";

interface PanelNotesProps {
  id: string;
  annotationDocs: AtlasNode[];
  linkedNodes: AtlasNode[];
  cousinDocs: CousinDoc[];
  citedBy: EdgeResult["inbound"];
  relations: PanelRelation[];
  onNav: Nav;
  onNavDoc: Nav;
  selectable?: boolean;
  byParent?: Map<string | null, AtlasNode[]>;
}

const CARD_STACK = "flex flex-col gap-[10px]";

// The right panel's notes section: the doc's Element Annotations, the documents
// it links to, its cousins under the other Prime Agents, what cites it, and its
// extracted relations. Each list is omitted when empty.
export function PanelNotes(props: PanelNotesProps) {
  const { annotationDocs, linkedNodes, cousinDocs, citedBy, relations, onNav } = props;
  const list = { onNav, selectable: props.selectable, byParent: props.byParent };
  return (
    <>
      {/* Element Annotations — this document's OWN Annotation-type children
          (`<doc_no>.0.3.N`), the hardest to reach in the reader, so they lead. */}
      {annotationDocs.length > 0 && (
        <RelatedDocList {...list} label="annotated by" kind="annotation_doc" blurb="Element Annotations attached to this document."
          items={annotationDocs.map((node) => ({ node }))} className="mb-8 pb-5 border-b border-border" listClassName={CARD_STACK} />
      )}
      {linkedNodes.length > 0 && (
        <RelatedDocList {...list} label="linked documents" kind="linked_doc" items={linkedNodes.map((node) => ({ node }))} />
      )}
      {cousinDocs.length > 0 && (
        <RelatedDocList {...list} label="cousin documents" kind="cousin_doc" blurb="Equivalent documents under the other Prime Agents."
          items={cousinDocs.map(({ node, agent }) => ({ node, eyebrow: <span className="atlas-agent-pill">{agent}</span> }))}
          className="mt-8 pt-5 border-t border-border" listClassName={CARD_STACK} />
      )}
      {citedBy.length > 0 && <CitedByList citedBy={citedBy} onNav={onNav} />}
      {relations.length > 0 && <RelationsList {...props} />}
    </>
  );
}

// Documents that cite this one, by doc_no (a short id when the edge has none).
function CitedByList({ citedBy, onNav }: { citedBy: EdgeResult["inbound"]; onNav: Nav }) {
  return (
    <div className="mt-8">
      <p className={`${SECTION_HEAD} mb-3`}>cited by · {citedBy.length}</p>
      <div className="space-y-1">
        {citedBy.map((e, i) => (
          <button
            key={i}
            className="w-full text-left px-2 py-1.5 rounded text-xs mono hover:bg-hover transition-colors text-accent hover:underline"
            onClick={() => onNav("cited_by", e.f)}
          >
            {e.s?.[0] ?? e.f.slice(0, 8)}
          </button>
        ))}
      </div>
    </div>
  );
}
