import { formatMonth, formatUsd } from "../../lib/settlements";
import { AGENT_W, GROUP_HEADING, HEADERS, HEADER_Y, LEFT_X, MID_X, NODE_W, RIGHT_X, SOURCE_LABEL, type FlowLayout } from "../../lib/mscFlowLayout";
import { RingHoverStyles } from "./MscRingHoverStyles";
import { markId, AmountPill, pillText } from "./MscRingPills";
import { FlowAgentGroup } from "./MscFlowAgent";
import type { OverviewPrime } from "./MscRingPrime";
import { useTweenedFlow } from "../../hooks/useTweenedFlow";

/** Pills draw at three times the orbit's size: this 3000-wide canvas
 *  renders at roughly a third, so the hover text lands near 16px on screen. */
const PILL_SCALE = 3;

interface Props {
  layout: FlowLayout;
  primes: OverviewPrime[];
  month: string;
  /** Compact ecosystem To-Sky figure, shown above the Sky bar. */
  centerFigure: string;
}

/** The column headers over the three node groups — pure chrome, so the
 *  overview's loading skeleton draws them on an empty canvas too. */
export function FlowHeaders() {
  return (
    <>
      <text x={LEFT_X + NODE_W} y={HEADER_Y} textAnchor="end" fontSize={30} className="msc-flow-header mono">
        {HEADERS.source}
      </text>
      <text x={MID_X + AGENT_W / 2} y={HEADER_Y} textAnchor="middle" fontSize={30} className="msc-flow-header mono">
        {HEADERS.prime}
      </text>
      <text x={RIGHT_X + NODE_W / 2} y={HEADER_Y} textAnchor="middle" fontSize={30} className="msc-flow-header mono">
        {HEADERS.sky}
      </text>
    </>
  );
}

/** The three-stage flow chart: sources → Primes → Sky. Speaks the orbital
 *  chart's mark vocabulary (.msc-ring-prime / .msc-ring-mark / data-mark /
 *  .msc-ring-<kind> / .msc-ring-sky-wedge), so the key, the cross-chart
 *  hover and the pills work on it unchanged. A month change is drawn as a
 *  transition (useTweenedFlow): bars stretch and slide, ribbons re-thread,
 *  a Prime that joins or leaves grows in or peels away. */
export function MscFlow({ layout: target, primes, month, centerFigure }: Props) {
  const layout = useTweenedFlow(target);
  const meta = new Map(primes.map((p) => [p.flow.prime, p]));
  const labelOf = (prime: string) => meta.get(prime)?.label ?? prime;
  // Hover rules come from the month being shown, not the frame in flight.
  const marks = target.agents.map((a) => ({
    prime: a.prime,
    kinds: [...a.inbound.map((l) => l.kind as string), "gross", ...(a.outbound.length ? ["sky", "share"] : [])],
  }));
  const { sky } = layout;
  return (
    <>
      <RingHoverStyles marks={marks} />
      <figure className="msc-ring-frame msc-flow-frame" aria-label={`Monthly Settlement Cycle flows for ${formatMonth(month)}`}>
        <svg className="msc-ring msc-flow" viewBox={`0 0 ${layout.width} ${layout.height}`} preserveAspectRatio="xMidYMid meet">
          <FlowHeaders />
          {/* Sky's LEFT node and its ribbons into the demand-side bars: that
              money is owed BY Sky (A.2.4.1.2.2.1.1.1), so it starts here and
              Sky appears at both ends of the chart. Drawn under the source
              bars so the ribbons dock behind them. */}
          {layout.skySource && (
            <g className="msc-flow-sky-source" style={{ opacity: layout.skySource.alpha }}>
              {layout.skySource.links.map((l) => (
                <path key={l.kind} d={l.path} className={`msc-ring-slice msc-ring-${l.kind}`} />
              ))}
              {/* Painted in Sky's own blue, like the bar on the right, so the
                  two ends read as the same party rather than two charts. */}
              {/* No label of its own: the group heading above already reads
                  "OWED BY SKY | <total>". A second "Sky | …" line here sat in
                  the line-item column and read as a fourth source. */}
              <rect
                x={layout.skySource.x}
                y={layout.skySource.y}
                width={NODE_W}
                height={layout.skySource.h}
                className="msc-ring-sky-wedge"
                style={{ fill: "var(--msc-sky)" }}
              />
            </g>
          )}
          {layout.sources.map((s) => (
            <g key={s.kind} className="msc-flow-source" data-kind={s.kind} data-origin={s.origin} style={{ opacity: s.alpha }}>
              {/* The group heading carries the group's total, so the Sky node
                  below needs no label of its own. */}
              {s.headingY != null && (
                <text x={LEFT_X + NODE_W} y={s.headingY} textAnchor="end" fontSize={30} className="msc-flow-header mono">
                  {GROUP_HEADING[s.origin]}
                  {s.origin === "sky" && layout.skySource ? ` | ${formatUsd(layout.skySource.value, true)}` : ""}
                </text>
              )}
              <rect x={s.x} y={s.y} width={NODE_W} height={s.h} className={`msc-ring-${s.kind}`} />
              <text x={s.labelX - 12} y={s.labelY + 15} textAnchor="end" fontSize={44} className="msc-ring-label">
                {SOURCE_LABEL[s.kind]}
                <tspan className="msc-ring-sublabel mono"> | {formatUsd(s.value, true)}</tspan>
              </text>
            </g>
          ))}
          {/* Sky: one bar, split by Prime and by type — the same "To Sky"
              name-then-figure treatment as the orbit's pie. The Primes are
              not named here again; each share's hover pill says whose. */}
          <text x={sky.x} y={sky.y - 24} textAnchor="start" fontSize={54} className="msc-ring-label">
            To Sky
            <tspan className="msc-ring-sublabel mono"> | {centerFigure}</tspan>
          </text>
          {sky.shares.map((sh) => (
            <g key={sh.prime} className="msc-ring-mark" data-mark={markId(sh.prime, "share")} style={{ opacity: sh.alpha }}>
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
                  <AmountPill
                    scale={PILL_SCALE}
                    mark={markId(a.prime, "gross")}
                    text={pillText("gross", a.gross, label)}
                    detail={a.loss > 0 ? [`−${formatUsd(a.loss, true)} supply-side loss`] : undefined}
                    x={a.grossPillX}
                    y={a.grossPillY}
                    toX={a.labelX}
                    toY={a.grossAnchorY}
                  />
                  {a.inbound.map((l) => (
                    <AmountPill scale={PILL_SCALE} key={l.kind} mark={markId(a.prime, l.kind)} text={pillText(l.kind, l.value, label)} x={l.pillX} y={l.pillY} toX={l.midX} toY={l.midY} />
                  ))}
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
