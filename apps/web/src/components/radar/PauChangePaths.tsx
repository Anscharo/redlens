import type { ComponentProps } from "react";
import { changePlumbings } from "@/lib/pauChangePaths";
import { PAU_ANCHOR } from "@/lib/pauAnchors";
import type { PauKind } from "@/lib/pauRegistry";
import { PauPartHeading } from "./PauSectionHeading";
import { PlumbingKey } from "./PauPlumbingKey";
import { PlumbingSvg } from "./PauPlumbingSvg";

export interface PauChangePathsProps extends ComponentProps<"section"> {
  /** The generations of the Prime's deployments: each family it runs gets its diagram. */
  kinds: readonly PauKind[];
}

/**
 * How the Prime's PAUs change, just above the change history: one lane per
 * path (pauChangePaths.ts), each ending at what it can change, drawn once for
 * its EVM controllers and once for a Solana one. It reads no data; the change
 * history credits each stored change to a path.
 */
export function PauChangePaths({ kinds, className, ...props }: PauChangePathsProps) {
  const diagrams = changePlumbings(kinds);
  if (diagrams.length === 0) return null;
  return (
    <section aria-labelledby={PAU_ANCHOR.changePaths} className={`mb-8 ${className ?? ""}`} {...props}>
      <PauPartHeading anchor={{ id: PAU_ANCHOR.changePaths, aliases: [] }}>How it changes</PauPartHeading>
      {diagrams.map((d) => (
        <figure key={d.id} className="mb-4" data-change-paths={d.id}>
          {diagrams.length > 1 && <h3 className="mono text-[12px] mb-1" style={{ color: "var(--tan)" }}>{d.title}</h3>}
          <div className="overflow-x-auto">
            <PlumbingSvg plumbing={d} />
          </div>
          <figcaption className="mt-2 text-[12px]" style={{ color: "var(--tan-3)" }}>
            <PlumbingKey plumbing={d} />
          </figcaption>
        </figure>
      ))}
      <p className="text-[12px]" style={{ color: "var(--tan-3)" }}>
        Each lane is one way the settings change, ending at what that way can touch. Moving funds changes no setting: a relayer&apos;s move only draws a limit down,
        and the limit refills by itself. <a href={`#${PAU_ANCHOR.changeHistory}`} className="text-accent hover:underline">Change history</a> lists every change
        made so far with the path it took.
      </p>
    </section>
  );
}
