import { formatMonth, formatUsd } from "../../lib/settlements";
import { NODE_W, SOURCE_LABEL, type FlowLayout } from "../../lib/mscFlowLayout";
import { RingHoverStyles } from "./MscRingHoverStyles";
import { markId, AmountPill, pillText } from "./MscRingPills";
import { FlowAgentGroup } from "./MscFlowAgent";
import type { OverviewPrime } from "./MscRingPrime";

/** Pills draw at twice the orbit's size: this canvas renders about half. */
const PILL_SCALE = 2;

interface Props {
  layout: FlowLayout;
  primes: OverviewPrime[];
  month: string;
  /** Compact ecosystem To-Sky figure, shown above the Sky bar. */
  centerFigure: string;
}

/** The three-stage flow chart: sources → Primes → Sky. Speaks the orbital
 *  chart's mark vocabulary (.msc-ring-prime / .msc-ring-mark / data-mark /
 *  .msc-ring-<kind> / .msc-ring-sky-wedge), so the key, the cross-chart
 *  hover and the pills work on it unchanged. */
export function MscFlow({ layout, primes, month, centerFigure }: Props) {
  const meta = new Map(primes.map((p) => [p.flow.prime, p]));
  const labelOf = (prime: string) => meta.get(prime)?.label ?? prime;
  const marks = layout.agents.map((a) => ({
    prime: a.prime,
    kinds: [...a.inbound.map((l) => l.kind as string), "gross", ...(a.outbound.length ? ["sky", "share"] : []), ...(a.loss ? ["loss"] : [])],
  }));
  const { sky } = layout;
  return (
    <>
      <RingHoverStyles marks={marks} />
      <figure className="msc-ring-frame msc-flow-frame" aria-label={`Monthly Settlement Cycle flows for ${formatMonth(month)}`}>
        <svg className="msc-ring msc-flow" viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="xMidYMid meet">
          <defs>
            <pattern id="msc-ring-neg-kept" patternUnits="userSpaceOnUse" width={8} height={8} patternTransform="rotate(45)">
              <rect width={4.5} height={8} style={{ fill: "var(--msc-kept)" }} />
            </pattern>
          </defs>
          {layout.sources.map((s) => (
            <g key={s.kind} className="msc-flow-source" data-kind={s.kind}>
              <rect x={s.x} y={s.y} width={NODE_W} height={s.h} className={`msc-ring-${s.kind}`} />
              <text x={s.x - 12} y={s.labelY - 6} textAnchor="end" fontSize={32} className="msc-ring-label">
                {SOURCE_LABEL[s.kind]}
              </text>
              <text x={s.x - 12} y={s.labelY + 30} textAnchor="end" fontSize={30} className="msc-ring-sublabel mono">
                {formatUsd(s.value, true)}
              </text>
            </g>
          ))}
          {/* Sky: one bar, split by Prime and by type — the same "To Sky"
              name-then-figure treatment as the orbit's pie. The Primes are
              not named here again; each share's hover pill says whose. */}
          <text x={sky.x + NODE_W / 2} y={sky.y - 60} textAnchor="middle" fontSize={48} className="msc-ring-label">
            To Sky
          </text>
          <text x={sky.x + NODE_W / 2} y={sky.y - 20} textAnchor="middle" fontSize={32} className="msc-ring-sublabel mono">
            {centerFigure}
          </text>
          {sky.shares.map((sh) => (
            <g key={sh.prime} className="msc-ring-mark" data-mark={markId(sh.prime, "share")}>
              {sky.segments
                .filter((seg) => seg.prime === sh.prime)
                .map((seg) => (
                  <rect key={seg.kind} x={sky.x} y={seg.y} width={NODE_W} height={seg.h} className="msc-ring-sky-wedge" data-prime={seg.prime} style={{ fill: `var(--msc-${seg.kind === "cof" ? "sky" : "sde"})` }} />
                ))}
            </g>
          ))}
          {layout.agents.map((a) => {
            const m = meta.get(a.prime);
            return m ? <FlowAgentGroup key={a.prime} agent={a} {...m} month={month} /> : null;
          })}
          <g className="msc-ring-pills">
            {sky.shares.map((sh) => (
              <AmountPill scale={PILL_SCALE} key={sh.prime} mark={markId(sh.prime, "share")} text={pillText("share", sh.value, labelOf(sh.prime))} x={sh.pillX} y={sh.pillY} toX={sky.x + NODE_W / 2} toY={sh.y + sh.h / 2} />
            ))}
            {layout.agents.map((a) => {
              const label = labelOf(a.prime);
              const first = a.outbound[0];
              return (
                <g key={a.prime}>
                  <AmountPill scale={PILL_SCALE} mark={markId(a.prime, "gross")} text={pillText("gross", a.gross, label)} x={a.grossPillX} y={a.grossPillY} toX={a.labelX} toY={a.grossAnchorY} />
                  {a.inbound.map((l) => (
                    <AmountPill scale={PILL_SCALE} key={l.kind} mark={markId(a.prime, l.kind)} text={pillText(l.kind, l.value, label)} x={l.pillX} y={l.pillY} toX={l.midX} toY={l.midY} />
                  ))}
                  {a.loss && (
                    <AmountPill scale={PILL_SCALE} mark={markId(a.prime, "loss")} text={pillText("loss", -a.loss.value, label)} x={a.loss.pillX} y={a.loss.pillY} toX={a.loss.x + a.loss.w / 2} toY={a.loss.y + a.loss.h / 2} />
                  )}
                  {first && (
                    <AmountPill
                      scale={PILL_SCALE}
                      mark={markId(a.prime, "sky")}
                      text={pillText("sky", a.sky, label, a.share)}
                      detail={[`${formatUsd(a.cof, true)} cost of funds`, `${formatUsd(a.sde, true)} Sky Direct Exposure`]}
                      x={first.pillX}
                      y={first.pillY}
                      toX={first.midX}
                      toY={first.midY}
                    />
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </figure>
    </>
  );
}
