import type { ComponentProps } from "react";
import { PLUMBING } from "@/lib/pauPlumbing";
import type { Anchor } from "@/lib/pauAnchors";
import type { PauKind } from "@/lib/pauRegistry";
import { PauSectionHeading } from "./PauSectionHeading";
import { PlumbingKey } from "./PauPlumbingKey";
import { PlumbingSvg } from "./PauPlumbingSvg";

export interface PauPlumbingProps extends ComponentProps<"section"> {
  /** The deployment's generation: its own plumbing is the one drawn. */
  kind: PauKind;
  /** The deployment's fragment; the diagram is `#<deployment>-how-it-fits`. */
  anchor: Anchor;
}

/**
 * How one deployment is plumbed, at the top of its card: a static picture of
 * which part answers to which for its controller generation (pauPlumbing.ts).
 * It reads no data.
 */
export function PauPlumbing({ kind, anchor, className, ...props }: PauPlumbingProps) {
  const plumbing = PLUMBING[kind];
  return (
    <section className={`mt-3 ${className ?? ""}`} data-plumbing={kind} {...props}>
      <PauSectionHeading deployment={anchor} section="how-it-fits">How it fits together</PauSectionHeading>
      <figure>
        <div className="overflow-x-auto">
          <PlumbingSvg plumbing={plumbing} scope={`${plumbing.id}-${anchor.id}`} />
        </div>
        <figcaption className="mt-2 text-[12px]" style={{ color: "var(--tan-3)" }}>
          <PlumbingKey plumbing={plumbing} />
        </figcaption>
      </figure>
    </section>
  );
}
