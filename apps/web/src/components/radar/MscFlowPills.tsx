import { formatUsd } from "../../lib/settlements";
import { NODE_W, type FlowLayout } from "../../lib/mscFlowLayout";
import { markId, AmountPill, pillText } from "./MscRingPills";

/** Pills draw at three times the orbit's size: this 3000-wide canvas
 *  renders at roughly a third, so the hover text lands near 16px on screen. */
const PILL_SCALE = 3;

/** Every hover pill on the flow chart, in one top layer so a pill is never
 *  painted under a later mark. One per Sky share, one per Prime's gross,
 *  one per inbound ribbon, and one for the To-Sky pair. */
export function FlowPills({ layout, labelOf }: { layout: FlowLayout; labelOf: (prime: string) => string }) {
  const { sky } = layout;
  return (
    <g className="msc-ring-pills">
      {sky.shares.map((sh) => (
        <AmountPill
          scale={PILL_SCALE}
          key={sh.prime}
          mark={markId(sh.prime, "share")}
          text={pillText("share", sh.value, labelOf(sh.prime))}
          x={sh.pillX}
          y={sh.pillY}
          toX={sky.x + NODE_W / 2}
          toY={sh.y + sh.h / 2}
        />
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
  );
}
