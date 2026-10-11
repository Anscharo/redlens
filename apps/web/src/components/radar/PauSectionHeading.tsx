import type { ReactNode } from "react";
import { sectionAnchor, type Anchor, type PauSection } from "@/lib/pauAnchors";
import { HeadingAnchor } from "../HeadingAnchor";

const aliasAttr = (a: Anchor) => (a.aliases.length ? a.aliases.join(" ") : undefined);

/** The fragment attributes of a linkable PAU page element: its id, the aliases that also reach it (pauAnchors.ts), and room under the sticky header. */
export const anchorProps = (a: Anchor) => ({ id: a.id, "data-anchor-alias": aliasAttr(a), style: { scrollMarginTop: "64px" } });

/** A deployment section's h4, linkable as `#<deployment>-<section>` and by the bare section name. */
export function PauSectionHeading({ deployment, section, children }: { deployment: Anchor; section: PauSection; children: ReactNode }) {
  const a = sectionAnchor(deployment, section);
  return (
    <h4 {...anchorProps(a)} className="heading-with-anchor mono text-[11px] uppercase tracking-wider mb-1" style={{ ...anchorProps(a).style, color: "var(--tan-3)" }}>
      {children}
      <HeadingAnchor id={a.id} />
    </h4>
  );
}
