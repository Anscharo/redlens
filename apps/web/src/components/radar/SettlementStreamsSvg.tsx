import { formatUsd } from "../../lib/settlements";
import type { StreamModel } from "@/lib/settlementStreams";
import { KEPT_STUB, LABEL_W, NODE_W, PRIME_X, SKY_LABEL_X, SKY_X, TOP, type Stream, type StreamLayout } from "../../lib/streamLayout";
import { textWidth } from "../../lib/textWidth";
import { ROUTES } from "@/lib/routes";
import { SvgRouteLink } from "./SvgRouteLink";

/** Each stream wears the colour of what it carries; a negative one (a
 *  loss, its arrow reversed) wears the loss stripes instead. */
const INK: Record<string, string> = {
  revenue: "var(--tan-3)",
  cof: "var(--msc-sky)",
  sde: "var(--msc-sde)",
  kept: "var(--msc-kept)",
  agentRate: "var(--msc-rate)",
  distributionRewards: "var(--msc-dr)",
  gar: "var(--msc-gar)",
  chroniclePoints: "var(--msc-cp)",
};
export const inkOf = (key: string) => INK[key] ?? "var(--msc-demand)";
const LOSS = "url(#msc-stream-loss)";

const NAME_FONT = "11px 'Inter', system-ui, sans-serif";
const AMOUNT_ROOM = 64;

/** The venue name, cut to fit the gutter beside its right-aligned amount. */
function fitName(label: string): string {
  const room = LABEL_W - AMOUNT_ROOM;
  if (textWidth(label, NAME_FONT, 6.2) <= room) return label;
  let s = label;
  while (s.length > 1 && textWidth(`${s}…`, NAME_FONT, 6.2) > room) s = s.slice(0, -1);
  return `${s}…`;
}

/** One payment: a hit area, the stream, its arrowhead, and the moving
 *  dashes that show which way it runs (stilled under reduced motion). */
function StreamMark({ s, title }: { s: Stream; title: string }) {
  const ink = s.loss ? LOSS : inkOf(s.series ?? s.kind);
  return (
    <g className="msc-stream" data-kind={s.kind} data-venue={s.venue}>
      <title>{title}</title>
      <path d={s.d} className="msc-stream-hit" strokeWidth={Math.max(s.w, 12)} />
      <path d={s.d} className="msc-stream-body" stroke={ink} strokeWidth={s.w} />
      <path d={s.head} fill={ink} />
      {s.kind !== "kept" && <path d={s.d} className="msc-stream-flow" strokeWidth={Math.min(3, Math.max(1, s.w * 0.35))} />}
    </g>
  );
}

function streamTitle(s: Stream, model: StreamModel, prime: string): string {
  const amt = formatUsd(s.value);
  const venue = model.venues.find((v) => v.id === s.venue)?.label ?? "";
  if (s.kind === "revenue") return s.loss ? `${venue}: a loss of ${formatUsd(-s.value)}, absorbed by ${prime}` : `${venue}: ${amt} earned for ${prime}`;
  if (s.kind === "sde") return `${venue}: ${amt} Sky Direct Exposure, passing through ${prime} to Sky`;
  if (s.kind === "cof") return `Cost of funds: ${amt} from ${prime} to Sky`;
  if (s.kind === "kept") return s.loss ? `${prime} paid ${formatUsd(-s.value)} more cost of funds than it earned` : `${amt} stays with ${prime}`;
  return `${model.demand.find((d) => d.key === s.series)?.label ?? "Demand side"}: ${amt} from Sky to ${prime}`;
}

export function SettlementStreamsSvg({ layout, model, primeLabel, month }: { layout: StreamLayout; model: StreamModel; primeLabel: string; month?: string }) {
  const { prime, sky, kept, demand } = layout;
  const behind = layout.streams.filter((s) => s.kind === "sde" || s.kind === "revenue");
  const front = layout.streams.filter((s) => s.kind !== "sde" && s.kind !== "revenue");
  return (
    <svg className="msc-streams" viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-labelledby="msc-streams-title msc-streams-desc">
      <title id="msc-streams-title">{`${primeLabel}'s settlement streams`}</title>
      <desc id="msc-streams-desc">
        {`Revenue earned at each venue flows into ${primeLabel}. Cost of funds ${formatUsd(model.cof)} and Sky Direct Exposure ${formatUsd(model.sde)} go to Sky, ${formatUsd(model.toSky)} in all; ${formatUsd(model.kept)} stays with ${primeLabel}. Separately, Sky pays ${primeLabel} ${formatUsd(model.demandTotal)} on the demand side. The two settlement amounts run in opposite directions and are never netted.`}
      </desc>
      <defs>
        <pattern id="msc-stream-loss" patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
          <rect width={3} height={6} style={{ fill: "var(--msc-loss)" }} />
        </pattern>
      </defs>
      <g className="mono msc-streams-header" fontSize={10}>
        <text x={0} y={TOP - 22}>EARNED AT</text>
        <text x={PRIME_X + NODE_W / 2} y={TOP - 22} textAnchor="middle">{primeLabel.toUpperCase()}</text>
        <text x={SKY_X + NODE_W / 2} y={TOP - 22} textAnchor="middle">SKY</text>
      </g>
      {layout.rows.map((r) => (
        <g key={r.id} className="msc-stream-row" data-venue={r.id}>
          <text x={0} y={r.y} dominantBaseline="middle" fontSize={11} className="msc-stream-name">{fitName(r.label)}</text>
          <text x={LABEL_W} y={r.y} dominantBaseline="middle" textAnchor="end" fontSize={10} className="mono msc-stream-amount">{formatUsd(r.revenue || r.sde, true)}</text>
        </g>
      ))}
      {behind.map((s) => <StreamMark key={s.key} s={s} title={streamTitle(s, model, primeLabel)} />)}
      <rect x={prime.x} y={prime.y} width={NODE_W} height={prime.h} className="msc-stream-prime" />
      {demand?.parts.map((p) => <rect key={p.key} x={PRIME_X} y={p.y} width={NODE_W} height={p.h} fill={inkOf(p.key)} />)}
      {front.map((s) => <StreamMark key={s.key} s={s} title={streamTitle(s, model, primeLabel)} />)}
      {sky.inH > 0 && <rect x={SKY_X} y={sky.inY} width={NODE_W} height={sky.inH} fill="var(--msc-sky)" />}
      {sky.outH > 0 && <rect x={SKY_X} y={sky.outY} width={NODE_W} height={sky.outH} fill="var(--msc-sky)" />}
      {kept && (
        <text x={PRIME_X + NODE_W + KEPT_STUB + 8} y={kept.y} dominantBaseline="middle" fontSize={10} className="mono msc-stream-label">
          {kept.value < 0 ? `supply-side loss | ${formatUsd(kept.value, true)}` : `stays with ${primeLabel} | ${formatUsd(kept.value, true)}`}
        </text>
      )}
      <SkyLabels layout={layout} model={model} month={month} />
    </svg>
  );
}

function SkyLabels({ layout, model, month }: { layout: StreamLayout; model: StreamModel; month?: string }) {
  const { sky } = layout;
  const toSky = <tspan>{`To Sky | ${formatUsd(model.toSky, true)}`}</tspan>;
  return (
    <g className="mono msc-stream-label" fontSize={10}>
      {sky.inH > 0 && (
        <text x={SKY_LABEL_X} y={sky.inY + sky.inH / 2} dominantBaseline="middle">
          {month ? (
            <SvgRouteLink to={`${ROUTES.RADAR}?msc=${month}`} className="msc-stream-sky-link" label="Open this month in the ecosystem Monthly Settlement Cycle overview">
              {toSky}
            </SvgRouteLink>
          ) : toSky}
          <tspan x={SKY_LABEL_X} dy={13} className="msc-stream-sub">{`CoF ${formatUsd(model.cof, true)} + SDE ${formatUsd(model.sde, true)}`}</tspan>
        </text>
      )}
      {sky.outH > 0 && (
        <text x={SKY_LABEL_X} y={sky.outY + sky.outH / 2} dominantBaseline="middle">
          {`From Sky | ${formatUsd(model.demandTotal, true)}`}
          <tspan x={SKY_LABEL_X} dy={13} className="msc-stream-sub">demand side</tspan>
        </text>
      )}
    </g>
  );
}
