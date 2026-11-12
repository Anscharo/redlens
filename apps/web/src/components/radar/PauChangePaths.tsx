import type { ComponentProps } from "react";
import { CHANGE_PLUMBING } from "@/lib/pauChangePaths";
import { PAU_ANCHOR } from "@/lib/pauAnchors";
import { PauPartHeading } from "./PauSectionHeading";
import { PlumbingSvg } from "./PauPlumbingSvg";

/**
 * How a PAU's configuration changes, under the plumbing diagram: one lane per
 * path (pauChangePaths.ts), each ending at what it can change. It reads no
 * data; the change history further down credits each stored change to a path.
 */
export function PauChangePaths({ className, ...props }: ComponentProps<"section">) {
  return (
    <section aria-labelledby={PAU_ANCHOR.changePaths} className={`mb-8 ${className ?? ""}`} {...props}>
      <PauPartHeading anchor={{ id: PAU_ANCHOR.changePaths, aliases: [] }}>How it changes</PauPartHeading>
      <figure>
        <div className="overflow-x-auto">
          <PlumbingSvg plumbing={CHANGE_PLUMBING} />
        </div>
        <figcaption className="mt-2 text-[12px]" style={{ color: "var(--tan-3)" }}>
          Each lane is one way a PAU&apos;s settings change, ending at what that way can touch. Moving funds changes no setting: a relayer&apos;s move only draws a rate
          limit down, and the limit refills by itself. <a href={`#${PAU_ANCHOR.changeHistory}`} className="text-accent hover:underline">Change history</a> lists every
          change made so far with the path it took. A dashed arrow holds only for some deployments. Hover an arrow for the contract rule behind it.
        </figcaption>
      </figure>
    </section>
  );
}
