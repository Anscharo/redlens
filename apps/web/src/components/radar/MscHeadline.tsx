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

export interface MscHeadlineProps {
  /** Null while the settlements are still loading: the card keeps its
   *  labels and shape and shows a dash for each figure. */
  eco: MscFigures | null;
  /** The settlement month these figures are for (YYYY-MM), named at the
   *  head of the card so the numbers are never read as a running total. */
  month: string | null;
  /** Whose retained revenue the prime-side equation is: the ecosystem card
   *  says "Primes", a Prime's own page names the Prime ("Spark"). */
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
 *  drift). To Sky is shown as the equation it is, cost of funds + Sky
 *  Direct Exposure, so nobody adds the components on top of the total.
 *
 *  The supply and demand sides are NOT summed into one figure, because the
 *  Monthly Settlement Cycle settles them as two amounts running in
 *  opposite directions: what a Prime owes Sky for Supply Side Primitives
 *  (A.2.4.1.2.2.1.1.2) and what Sky owes the Prime for Demand Side
 *  Primitives and the Agent Rate (A.2.4.1.2.2.1.1.1), settled together but
 *  never added (A.2.4.1.2.2.1.1.3). The demand-side label names that
 *  direction rather than leaving it to be guessed. */
export function MscHeadline({ eco, month, earner, play }: MscHeadlineProps) {
  const who = earner ? `${earner}` : "Primes";
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
        aria-label={`Supply-side kept by ${who}, and demand-side owed by Sky to ${who} — two separate settlement amounts, never added`}
      >
        <Figure label={`Supply-side kept by ${who}`} value={eco?.kept ?? null} />
        <Figure label={`Demand-side from Sky to ${who}`} value={eco?.demand ?? null} />
      </div>
    </div>
  );
}
