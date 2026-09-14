import { formatMonth, formatUsd } from "../../lib/settlements";

/** The five figures the card shows — an ecosystem month's (EcosystemThreeWay
 *  satisfies this) or one Prime's. */
export interface MscFigures {
  sky: number;
  cof: number;
  sde: number;
  kept: number;
  demand: number;
}

interface Props {
  eco: MscFigures;
  /** The settlement month these figures are for (YYYY-MM), named at the
   *  head of the card so the numbers are never read as a running total. */
  month: string;
  /** The two prime-side labels: the ecosystem card says "by Primes" /
   *  "to Primes"; a Prime's own page drops the qualifier. */
  labels?: { kept: string; demand: string };
  /** On a Prime's page, its identity color as a swatch before the month —
   *  the same color as its ring rim and timeseries layer on the overview. */
  identity?: { color: string };
  /** The overview's month autoplay, under the month it steps through. */
  play?: { playing: boolean; onToggle: () => void };
}

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

/** The month's figures as a card — the ecosystem's on the overview, one
 *  Prime's on its settlement page (same component, so the two pages can't
 *  drift). To Sky is shown as the equation it is — cost of funds + Sky
 *  Direct Exposure — so nobody adds the two components on top of it. */
export function MscHeadline({ eco, month, labels, identity, play }: Props) {
  return (
    <div className="msc-card rounded p-4 mb-4 flex flex-wrap items-end gap-x-4 gap-y-3 text-sm">
      <div className="self-center">
        <div className="flex items-center gap-2 mono" style={{ color: "var(--tan)" }}>
          {identity && <span className="msc-identity-swatch" style={{ background: identity.color }} aria-hidden="true" />}
          {formatMonth(month)}
        </div>
        {play && (
          <button
            type="button"
            className="msc-ts-play mono text-[10px] mt-1"
            onClick={play.onToggle}
            aria-pressed={play.playing}
            aria-label={play.playing ? "Pause the month autoplay" : "Play through the months, one second each"}
          >
            {play.playing ? "❚❚ pause" : "▶ play"}
          </button>
        )}
      </div>
      <span className="msc-headline-divider" aria-hidden="true" />
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2" aria-label="To Sky equals cost of funds plus Sky Direct Exposure">
        <Figure label="To Sky" value={eco.sky} />
        <Op>=</Op>
        <Figure label="cost of funds" value={eco.cof} muted />
        <Op>+</Op>
        <Figure label="Sky Direct Exposure" value={eco.sde} muted />
      </div>
      <span className="msc-headline-divider" aria-hidden="true" />
      <Figure label={labels?.kept ?? "Supply-side kept by Primes"} value={eco.kept} />
      <Figure label={labels?.demand ?? "Demand-side to Primes"} value={eco.demand} />
    </div>
  );
}
