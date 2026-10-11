import type { ReactNode } from "react";
import { sectionAnchor, type Anchor, type PauSection } from "@/lib/pauAnchors";
import { CopyLink } from "../CopyLink";

const aliasAttr = (a: Anchor) => (a.aliases.length ? a.aliases.join(" ") : undefined);

/** The fragment attributes of a linkable PAU page element: its id, the aliases that also reach it (pauAnchors.ts), and room under the sticky header. */
export const anchorProps = (a: Anchor) => ({ id: a.id, "data-anchor-alias": aliasAttr(a), style: { scrollMarginTop: "64px" } });

/** One of the page's two parts' h2, `#current-state` or `#change-history`, with its copy link. */
export function PauPartHeading({ anchor, children }: { anchor: Anchor; children: string }) {
  return (
    <div className="relative mb-1">
      <CopyLink id={anchor.id} label={children} top={1} />
      <h2 {...anchorProps(anchor)} className="mono text-[14px] uppercase tracking-wider" style={{ ...anchorProps(anchor).style, color: "var(--tan-2)" }}>
        {children}
      </h2>
    </div>
  );
}

/** A deployment section's h4, linkable as `#<deployment>-<section>` and by the bare section name, with its copy link. */
export function PauSectionHeading({ deployment, section, children }: { deployment: Anchor; section: PauSection; children: ReactNode }) {
  const a = sectionAnchor(deployment, section);
  return (
    <div className="relative mb-1">
      <CopyLink id={a.id} label={`${deployment.id} ${section.replace(/-/g, " ")}`} />
      <h4 {...anchorProps(a)} className="mono text-[11px] uppercase tracking-wider" style={{ ...anchorProps(a).style, color: "var(--tan-3)" }}>
        {children}
      </h4>
    </div>
  );
}
