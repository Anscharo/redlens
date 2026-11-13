import type { ReactNode } from "react";
import { sectionAnchor, type Anchor, type PauSection } from "@/lib/pauAnchors";
import { plumbLitTint } from "@/lib/pauPlumbingLinks";
import { CopyLink } from "../CopyLink";

const aliasAttr = (a: Anchor) => (a.aliases.length ? a.aliases.join(" ") : undefined);

/** The fragment attributes of a linkable PAU page element: its id, the aliases that also reach it (pauAnchors.ts), and room under the sticky header. */
export const anchorProps = (a: Anchor) => ({ id: a.id, "data-anchor-alias": aliasAttr(a), style: { scrollMarginTop: "64px" } });

/** The h2 of one of the page's parts (pauAnchors.ts PAU_ANCHOR), with its copy link. */
export function PauPartHeading({ anchor, children }: { anchor: Anchor; children: string }) {
  return (
    <div className="relative mb-2">
      <CopyLink id={anchor.id} label={children} top={6} />
      <h2 {...anchorProps(anchor)} className="mono text-[20px] uppercase tracking-wider" style={{ ...anchorProps(anchor).style, color: "var(--tan)" }}>
        {children}
      </h2>
    </div>
  );
}

interface PauSectionHeadingProps {
  deployment: Anchor;
  section: PauSection;
  /** The diagram part the section is about, as a link token (pauPlumbingLinks.ts); hovering either lights both. */
  link?: string;
  children: ReactNode;
}

/** A deployment section's h4, linkable as `#<deployment>-<section>` and by the bare section name, with its copy link. */
export function PauSectionHeading({ deployment, section, link, children }: PauSectionHeadingProps) {
  const a = sectionAnchor(deployment, section);
  return (
    <div className="relative mb-1 rounded" data-link={link} style={link ? { background: plumbLitTint("transparent") } : undefined}>
      <CopyLink id={a.id} label={`${deployment.id} ${section.replace(/-/g, " ")}`} />
      <h4 {...anchorProps(a)} className="mono text-[11px] uppercase tracking-wider" style={{ ...anchorProps(a).style, color: "var(--tan-3)" }}>
        {children}
      </h4>
    </div>
  );
}
