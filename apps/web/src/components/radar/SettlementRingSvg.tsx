import type { ReactNode } from "react";
import { formatUsd } from "../../lib/settlements";
import type { StreamModel } from "@/lib/settlementStreams";
import { citationFor } from "@/lib/settlementCitations";
import { ROUTES, atlasHref } from "@/lib/routes";
import { CX, CY, GUTTER, HEIGHT, PRIME_R, RING_R, WIDTH, type RingBand, type RingLayout } from "../../lib/settlementRingLayout";
import { SvgRouteLink } from "./SvgRouteLink";

/** Each band wears the colour of what it carries; a negative one wears
 *  the loss stripes instead. */
const INK: Record<string, string> = {
  cof: "var(--msc-sky)",
  sde: "var(--msc-sde)",
  agentRate: "var(--msc-rate)",
  distributionRewards: "var(--msc-dr)",
  gar: "var(--msc-gar)",
  chroniclePoints: "var(--msc-cp)",
};
export const ringInk = (key: string) => INK[key] ?? "var(--msc-demand)";
const LOSS = "url(#msc-ring-loss)";
const UNCITED = "A workbook figure: the Atlas defines no term for it";

function bandLabel(key: string, model: StreamModel): string {
  if (key === "cof") return "Cost of funds";
  if (key === "sde") return "Sky Direct Exposure";
  return model.demand.find((d) => d.key === key)?.label ?? key;
}

/** A figure's text, linked to the Atlas document that defines it — or
 *  muted and unlinked when the Atlas defines no term for it. */
function Cited({ figure, x, y, anchor, children }: { figure: string; x: number; y: number; anchor: "start" | "end"; children: ReactNode }) {
  const c = citationFor(figure);
  const text = (
    <text x={x} y={y} textAnchor={anchor} dominantBaseline="middle" className={c ? "msc-ring-cited" : "msc-ring-uncited"}>
      <title>{c ? `${c.term} — open in the Atlas` : UNCITED}</title>
      {children}
    </text>
  );
  return c ? <SvgRouteLink to={atlasHref(c.uuid)} className="msc-ring-link">{text}</SvgRouteLink> : text;
}

/** One lane's key, beside the ring: its total, then each band with a swatch. */
function LaneKey({ side, total, figure, title, bands, model }: { side: "left" | "right"; total: number; figure: string; title: string; bands: RingBand[]; model: StreamModel }) {
  if (bands.length === 0) return null;
  const x = side === "right" ? WIDTH - GUTTER + 4 : GUTTER - 4;
  const anchor = side === "right" ? "start" : "end";
  const sw = side === "right" ? x : x - 8;
  const tx = side === "right" ? x + 14 : x - 14;
  return (
    <g className="mono" fontSize={10}>
      <Cited figure={figure} x={x} y={CY - 24} anchor={anchor}>{`${title} | ${formatUsd(total, true)}`}</Cited>
      {bands.map((b, i) => (
        <g key={b.key}>
          <rect x={sw} y={CY - 4 + i * 16} width={8} height={8} fill={b.loss ? LOSS : ringInk(b.key)} />
          <Cited figure={b.key} x={tx} y={CY + i * 16} anchor={anchor}>{`${bandLabel(b.key, model)} ${formatUsd(b.value, true)}`}</Cited>
        </g>
      ))}
    </g>
  );
}

function Band({ b, title }: { b: RingBand; title: string }) {
  const ink = b.loss ? LOSS : ringInk(b.key);
  return (
    <g className="msc-ring-band" data-key={b.key}>
      <title>{title}</title>
      <path d={b.d} className="msc-ring-hit" strokeWidth={Math.max(b.w, 12)} />
      <path d={b.d} className="msc-ring-body" stroke={ink} strokeWidth={b.w} />
      {b.head && <path d={b.head} fill={ink} />}
      <path d={b.d} className="msc-ring-flow" strokeWidth={Math.min(3, Math.max(1, b.w * 0.35))} />
    </g>
  );
}

function PrimeDisc({ model, primeLabel }: { model: StreamModel; primeLabel: string }) {
  const loss = model.kept < 0;
  return (
    <g textAnchor="middle">
      <circle cx={CX} cy={CY} r={PRIME_R} className="msc-ring-prime" />
      <text x={CX} y={CY - 8} fontSize={13} className="msc-ring-prime-name">{primeLabel}</text>
      <text x={CX} y={CY + 10} fontSize={10} className={`mono msc-ring-uncited${loss ? " msc-ring-loss" : ""}`}>
        <title>{`${loss ? "Supply-side loss" : "Supply-side kept"}. ${UNCITED}.`}</title>
        {`${loss ? "loss" : "keeps"} ${formatUsd(model.kept, true)}`}
      </text>
    </g>
  );
}

/** Sky's name, linked to this month in the ecosystem overview. */
function SkyName({ month }: { month?: string }) {
  const name = <text x={CX} y={CY - RING_R - 14} textAnchor="middle" fontSize={11} className="mono msc-ring-sky-name">SKY</text>;
  if (!month) return name;
  return (
    <SvgRouteLink to={`${ROUTES.RADAR}?msc=${month}`} className="msc-ring-link" label="Open this month in the ecosystem Monthly Settlement Cycle overview">
      {name}
    </SvgRouteLink>
  );
}

export function SettlementRingSvg({ layout, model, primeLabel, month }: { layout: RingLayout; model: StreamModel; primeLabel: string; month?: string }) {
  const { outer, inner, inward, sky } = layout;
  const toSky = (b: RingBand) => `${bandLabel(b.key, model)}: ${formatUsd(b.value)} from ${primeLabel} to Sky${b.loss ? " (a loss)" : ""}`;
  const fromSky = (b: RingBand) => `${bandLabel(b.key, model)}: ${formatUsd(b.value)} from Sky to ${primeLabel}`;
  return (
    <svg className="msc-ring" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-labelledby="msc-ring-title msc-ring-desc">
      <title id="msc-ring-title">{`${primeLabel}'s settlement ring`}</title>
      <desc id="msc-ring-desc">
        {`Clockwise on the outer lane, ${primeLabel} owes Sky ${formatUsd(model.toSky)}: cost of funds ${formatUsd(model.cof)} and Sky Direct Exposure ${formatUsd(model.sde)}. Counterclockwise on the inner lane, Sky owes ${primeLabel} ${formatUsd(model.demandTotal)} on the demand side. The two amounts are never netted.`}
      </desc>
      <defs>
        <pattern id="msc-ring-loss" patternUnits="userSpaceOnUse" width={6} height={6} patternTransform="rotate(45)">
          <rect width={3} height={6} style={{ fill: "var(--msc-loss)" }} />
        </pattern>
      </defs>
      <PrimeDisc model={model} primeLabel={primeLabel} />
      {inner.map((b) => <Band key={b.key} b={b} title={fromSky(b)} />)}
      {inward && <path d={inward} fill={ringInk(inner[0].key)} className="msc-ring-inward" />}
      {outer.map((b) => <Band key={b.key} b={b} title={toSky(b)} />)}
      <rect x={sky.x} y={sky.y} width={sky.w} height={sky.h} rx={4} className="msc-ring-sky" />
      <SkyName month={month} />
      <LaneKey side="right" total={model.toSky} figure="toSky" title="To Sky ↻" bands={outer} model={model} />
      <LaneKey side="left" total={model.demandTotal} figure="fromSky" title="↺ From Sky" bands={inner} model={model} />
    </svg>
  );
}
