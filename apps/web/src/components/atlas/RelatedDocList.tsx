import { useCallback, type ReactNode } from "react";
import type { AtlasNode } from "@/types";
import { RelatedNode } from "../RelatedNode";
import { SECTION_HEAD, type Nav } from "./panelSections";

interface RelatedDocListProps {
  label: string;
  /** One-line explanation under the heading. */
  blurb?: string;
  /** Analytics kind for navigation from these cards. */
  kind: string;
  items: { node: AtlasNode; eyebrow?: ReactNode }[];
  onNav: Nav;
  selectable?: boolean;
  byParent?: Map<string | null, AtlasNode[]>;
  className?: string;
  listClassName?: string;
}

// A counted heading over related-document cards. RelatedNode is memoized, so the
// list hands every card one stable, kind-tagged callback.
export function RelatedDocList({ label, blurb, kind, items, onNav, selectable, byParent, className, listClassName }: RelatedDocListProps) {
  const navigate = useCallback((nid: string) => onNav(kind, nid), [onNav, kind]);
  return (
    <section className={className}>
      <p className={`${SECTION_HEAD} ${blurb ? "mb-2" : "mb-4"}`}>{label} · {items.length}</p>
      {blurb && <p className="text-xs leading-relaxed mb-4 text-tan-3">{blurb}</p>}
      <div className={listClassName}>
        {items.map(({ node, eyebrow }) => (
          <RelatedNode key={node.id} node={node} eyebrow={eyebrow} onNavigate={navigate} selectable={selectable} byParent={byParent} />
        ))}
      </div>
    </section>
  );
}
