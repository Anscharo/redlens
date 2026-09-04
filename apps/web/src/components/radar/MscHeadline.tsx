import { formatUsd } from "../../lib/settlements";
import type { EcosystemThreeWay } from "@/lib/settlementsOverview";

function Figure({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div>
      <div className="mono text-[10px] uppercase tracking-wider" style={{ color: "var(--tan-3)" }}>
        {label}
      </div>
      <div
        className={muted ? "mono text-base" : "mono text-lg"}
        style={{ color: muted ? "var(--tan-2)" : value < 0 ? "var(--accent)" : "var(--tan)" }}
      >
        {formatUsd(value)}
      </div>
    </div>
  );
}

function Op({ children }: { children: string }) {
  return (
    <span className="mono text-xl self-end pb-0.5" style={{ color: "var(--tan-3)" }} aria-hidden="true">
      {children}
    </span>
  );
}

/** The month's ecosystem figures as a card. To Sky is shown as the equation
 *  it is — cost of funds + Sky Direct Exposure — so nobody adds the two
 *  components on top of it. */
export function MscHeadline({ eco }: { eco: EcosystemThreeWay }) {
  return (
    <div className="msc-card rounded p-4 mb-4 flex flex-wrap items-end gap-x-4 gap-y-3 text-sm">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2" aria-label="To Sky equals cost of funds plus Sky Direct Exposure">
        <Figure label="To Sky" value={eco.sky} />
        <Op>=</Op>
        <Figure label="cost of funds" value={eco.cof} muted />
        <Op>+</Op>
        <Figure label="Sky Direct Exposure" value={eco.sde} muted />
      </div>
      <span className="msc-headline-divider" aria-hidden="true" />
      <Figure label="Supply kept by Primes" value={eco.kept} />
      <Figure label="Demand-side to Primes" value={eco.demand} />
    </div>
  );
}
