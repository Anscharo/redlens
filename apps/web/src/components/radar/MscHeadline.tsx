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
  /** Null while the settlements are still loading: the card keeps its
   *  labels and shape and shows a dash for each figure. */
  eco: MscFigures | null;
  /** The settlement month these figures are for (YYYY-MM), named at the
   *  head of the card so the numbers are never read as a running total. */
  month: string | null;
  /** Whose earnings the prime-side equation is: the ecosystem card says
   *  "Primes", a Prime's own page names the Prime ("Spark"). */
  earner?: string;
  /** The overview's month autoplay, under the month it steps through. */
  play?: { playing: boolean; onToggle: () => void };
}

// Every cell on the card is the same two rows — a LABEL_ROW-tall label
// line over a VALUE_ROW-tall figure line, both at one size — so with the
// cells bottom-aligned every label shares a baseline and every figure
// shares a baseline, month and operators included.
const LABEL_ROW = "h-5 leading-5";
const VALUE_ROW = "mono text-lg leading-7";

function Figure({ label, value, muted }: { label: string; value: number | null; muted?: boolean }) {
  return (
    <div>
      <div className={`mono text-[10px] uppercase tracking-wider ${LABEL_ROW}`} style={{ color: "var(--tan-3)" }}>
        {label}
      </div>
      {/* A negative figure is written in the loss red the charts stripe a
          loss in, and that beats the muted treatment — a negative component
          (a negative SDE, a supply-side loss) is the thing worth seeing. */}
      <div
        className={VALUE_ROW}
        style={{ color: value != null && value < 0 ? "var(--msc-loss)" : muted ? "var(--tan-2)" : "var(--tan)" }}
      >
        {value == null ? "—" : formatUsd(value)}
      </div>
    </div>
  );
}

function Op({ children }: { children: string }) {
  return (
    <div aria-hidden="true">
      <div className={LABEL_ROW} />
      <div className={VALUE_ROW} style={{ color: "var(--tan-3)" }}>
        {children}
      </div>
    </div>
  );
}

/** The month's figures as a card — the ecosystem's on the overview, one
 *  Prime's on its settlement page (same component, so the two pages can't
 *  drift). Both sides of the cycle are shown as the equations they are —
 *  To Sky = cost of funds + Sky Direct Exposure, and the Prime's earnings
 *  = supply-side kept + demand-side — so nobody adds a component on top of
 *  its own total. The two totals together are the month's gross revenue.
 *  Earnings is the same quantity `agentEarningsTotal` sums over a window
 *  for the charts card's heading: revenue the Prime keeps from the cycle,
 *  before any operating cost of its own (these workbooks carry none). */
export function MscHeadline({ eco, month, earner, play }: Props) {
  const earnings = eco ? eco.kept + eco.demand : null;
  const who = earner ?? "Primes";
  return (
    <div className="msc-card rounded p-4 mb-4 flex flex-wrap items-end gap-x-4 gap-y-3 text-sm">
      <div className="flex flex-col items-center">
        <div className={`${LABEL_ROW} flex items-center`}>
          {play && (
            <button
              type="button"
              className="msc-ts-play mono text-[10px] leading-none"
              onClick={play.onToggle}
              aria-pressed={play.playing}
              aria-label={play.playing ? "Pause the month autoplay" : "Play through the months, one second each"}
            >
              {play.playing ? "❚❚ pause" : "▶ play"}
            </button>
          )}
        </div>
        <div className={VALUE_ROW} style={{ color: "var(--tan)" }}>
          {month ? formatMonth(month) : "—"}
        </div>
      </div>
      <span className="msc-headline-divider" aria-hidden="true" />
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2" aria-label="To Sky equals cost of funds plus Sky Direct Exposure">
        <Figure label="To Sky" value={eco?.sky ?? null} />
        <Op>=</Op>
        <Figure label="cost of funds" value={eco?.cof ?? null} muted />
        <Op>+</Op>
        <Figure label="Sky Direct Exposure" value={eco?.sde ?? null} muted />
      </div>
      <span className="msc-headline-divider" aria-hidden="true" />
      <div
        className="flex flex-wrap items-end gap-x-3 gap-y-2"
        aria-label={`${who} earnings equals supply-side kept plus demand-side`}
      >
        <Figure label={`${who} earnings`} value={earnings} />
        <Op>=</Op>
        <Figure label="Supply-side kept" value={eco?.kept ?? null} muted />
        <Op>+</Op>
        <Figure label="Demand-side" value={eco?.demand ?? null} muted />
      </div>
    </div>
  );
}
