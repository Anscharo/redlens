import type { ComponentProps } from "react";
import { DIAMOND_NOTE, PLUMBING_EDGES, PLUMBING_FRAME, PLUMBING_KEY, PLUMBING_NODES, PLUMBING_VIEW, type PlumbingKind } from "@/lib/pauPlumbing";
import { PAU_ANCHOR } from "@/lib/pauAnchors";
import { PauPartHeading } from "./PauSectionHeading";
import { PLUMBING_COLOR, PlumbingEdgeLine, PlumbingNodeBox, plumbingMarker } from "./PauPlumbingParts";

const KINDS = Object.keys(PLUMBING_KEY) as PlumbingKind[];
const F = PLUMBING_FRAME;

/** The drawing: the PAU's three contracts framed, the accounts around them, and an arrow per access rule. */
function PlumbingSvg() {
  return (
    <svg viewBox={`0 0 ${PLUMBING_VIEW.w} ${PLUMBING_VIEW.h}`} role="img" aria-labelledby="pau-plumbing-title" className="block w-full" style={{ minWidth: 720, maxWidth: PLUMBING_VIEW.w }}>
      <title id="pau-plumbing-title">
        A relayer asks the controller for a move; the controller checks the rate limits and executes through the ALM proxy, which holds the funds. The admin configures all three; a freezer can remove a relayer.
      </title>
      <defs>
        {KINDS.map((k) => (
          <marker key={k} id={plumbingMarker(k)} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={7} markerHeight={7} orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" style={{ fill: PLUMBING_COLOR[k] }} />
          </marker>
        ))}
      </defs>
      <rect x={F.x} y={F.y} width={F.w} height={F.h} rx={10} fill="none" strokeDasharray="3 4" style={{ stroke: "var(--tan-3)" }} />
      <text x={F.x + 12} y={F.y + 18} fontSize={10} letterSpacing="0.06em" style={{ fill: "var(--tan-3)", textTransform: "uppercase" }}>{F.label}</text>
      {PLUMBING_EDGES.map((e) => <PlumbingEdgeLine key={`${e.from}-${e.to}`} edge={e} />)}
      {PLUMBING_NODES.map((n) => <PlumbingNodeBox key={n.id} node={n} />)}
    </svg>
  );
}

/**
 * How a PAU is plumbed, above the per-chain readings: one static picture of
 * which part answers to which (pauPlumbing.ts). It reads no data, so it shows
 * before any snapshot loads.
 */
export function PauPlumbing({ className, ...props }: ComponentProps<"section">) {
  return (
    <section aria-labelledby={PAU_ANCHOR.plumbing} className={`mb-8 ${className ?? ""}`} {...props}>
      <PauPartHeading anchor={{ id: PAU_ANCHOR.plumbing, aliases: [] }}>How it fits together</PauPartHeading>
      <figure className="max-w-[60rem]">
        <div className="overflow-x-auto">
          <PlumbingSvg />
        </div>
        <figcaption className="mt-2 text-[12px]" style={{ color: "var(--tan-3)" }}>
          <ul className="flex flex-wrap gap-x-4 mb-1">
            {KINDS.map((k) => (
              <li key={k}>
                <span aria-hidden="true" style={{ color: PLUMBING_COLOR[k] }}>→</span> {PLUMBING_KEY[k]}
              </li>
            ))}
            <li>dashed: only some deployments</li>
          </ul>
          <p>{DIAMOND_NOTE} Hover an arrow for the contract rule behind it.</p>
        </figcaption>
      </figure>
    </section>
  );
}
