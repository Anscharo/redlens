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
  /** The two prime-side labels: the ecosystem card says "by Primes" /
   *  "to Primes"; a Prime's own page drops the qualifier. */
  labels?: { kept: string; demand: string };
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
      <div className={VALUE_ROW} style={{ color: muted ? "var(--tan-2)" : value != null && value < 0 ? "var(--accent)" : "var(--tan)" }}>
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
 *  drift). To Sky is shown as the equation it is — cost of funds + Sky
 *  Direct Exposure — so nobody adds the two components on top of it. */
export function MscHeadline({ eco, month, labels, play }: Props) {
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
      <Figure label={labels?.kept ?? "Supply-side kept by Primes"} value={eco?.kept ?? null} />
      <Figure label={labels?.demand ?? "Demand-side to Primes"} value={eco?.demand ?? null} />
    </div>
  );
}
