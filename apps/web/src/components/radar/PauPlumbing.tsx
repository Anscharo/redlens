import type { ComponentProps } from "react";
import { urlEnum, useUrlState } from "../../hooks/useUrlState";
import { PLUMBING, PLUMBING_KEY, PLUMBING_KINDS, type PlumbingArch } from "@/lib/pauPlumbing";
import { PAU_ANCHOR } from "@/lib/pauAnchors";
import { PauPartHeading } from "./PauSectionHeading";
import { PLUMBING_COLOR } from "./PauPlumbingParts";
import { PLUMBING_EDGE_KINDS, PlumbingSvg } from "./PauPlumbingSvg";

interface KindToggleProps {
  kind: PlumbingArch;
  onKindChange: (kind: PlumbingArch) => void;
}

/** `?arch=diamond` draws the Diamond PAU, so a link can carry the choice. */
const ARCH = urlEnum<PlumbingArch>("monolithic", ["monolithic", "diamond"]);

/** The two generations as a pair of buttons; the pressed one is drawn. */
function PlumbingKindToggle({ kind, onKindChange }: KindToggleProps) {
  return (
    <div role="group" aria-label="Controller generation" className="flex gap-2 mb-3">
      {PLUMBING_KINDS.map((k) => (
        <button
          key={k.kind} type="button" aria-pressed={k.kind === kind} onClick={() => onKindChange(k.kind)}
          className="mono text-[11px] px-2 py-0.5 rounded cursor-pointer"
          style={k.kind === kind ? { border: "1px solid var(--accent)", color: "var(--tan)" } : { border: "1px solid var(--border)", color: "var(--tan-3)" }}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}

/**
 * How a PAU is plumbed, above the per-chain readings: one static picture per
 * controller generation of which part answers to which (pauPlumbing.ts), with
 * a toggle between the two. It reads no data, so it shows before any snapshot
 * loads.
 */
export function PauPlumbing({ className, ...props }: ComponentProps<"section">) {
  const [kind, setKind] = useUrlState("arch", ARCH);
  return (
    <section aria-labelledby={PAU_ANCHOR.plumbing} className={`mb-8 ${className ?? ""}`} data-kind={kind} {...props}>
      <PauPartHeading anchor={{ id: PAU_ANCHOR.plumbing, aliases: [] }}>How it fits together</PauPartHeading>
      <PlumbingKindToggle kind={kind} onKindChange={setKind} />
      <figure>
        <div className="overflow-x-auto">
          <PlumbingSvg plumbing={PLUMBING[kind]} />
        </div>
        <figcaption className="mt-2 text-[12px]" style={{ color: "var(--tan-3)" }}>
          <ul className="flex flex-wrap gap-x-4">
            {PLUMBING_EDGE_KINDS.map((k) => (
              <li key={k}>
                <span aria-hidden="true" style={{ color: PLUMBING_COLOR[k] }}>→</span> {PLUMBING_KEY[k]}
              </li>
            ))}
            <li>dashed arrow: only some deployments</li>
            <li><span style={{ color: "var(--accent)" }}>outlined</span>: only in a Diamond PAU</li>
            <li>hover an arrow for the contract rule behind it</li>
          </ul>
        </figcaption>
      </figure>
    </section>
  );
}
