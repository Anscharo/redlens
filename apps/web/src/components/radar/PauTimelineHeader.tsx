import { Address } from "../Address";
import { SpellLink } from "../SpellLink";
import { exactAmount, type BeamLimits, type TimelineGroup } from "../../lib/pau";
import { HeadingAnchor } from "../HeadingAnchor";

const dim = { color: "var(--tan-3)" };
const hours = (s: string | null) => (s === null ? "?" : `${Math.round((Number(s) / 3600) * 100) / 100} h`);

/** An executive's heading: its vote and spell, or the bare spell when no record titles it. */
function ExecutiveHeading({ g, anchor }: { g: TimelineGroup; anchor?: string }) {
  const x = g.executive;
  if (!x?.title) {
    return (
      <h3 className="heading-with-anchor text-[13px]" style={{ color: "var(--tan)" }}>
        <SpellLink address={g.spell!} /> <span className="mono text-[11px]" style={dim}>no executive record names this spell</span>
        {anchor && <HeadingAnchor id={anchor} />}
      </h3>
    );
  }
  return (
    <>
      <h3 className="heading-with-anchor text-[13px] mono">
        {x.url ? <a href={x.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">Executive Vote {x.date}</a> : <span>Executive Vote {x.date}</span>}
        {" · "}
        <SpellLink address={g.spell!} />
        {anchor && <HeadingAnchor id={anchor} />}
      </h3>
      <p className="text-[13px] leading-relaxed text-tan-2">{x.title}</p>
    </>
  );
}

/** What an executive, operator, relayed or direct group's changes came from, as its h3 (the other kinds are labelled by PauTimelineGroup). An operator's day is a collapsed group, so its header is phrasing content that the summary's h3 wraps; `beam` gives it the BeamState bounds. `anchor` is the group's fragment, linked from the h3. */
export function PauTimelineHeader({ g, beam, anchor }: { g: TimelineGroup; beam?: BeamLimits; anchor?: string }) {
  const first = g.entries[0];
  const o = first.origin;
  if (g.kind === "executive") return <ExecutiveHeading g={g} anchor={anchor} />;
  if (g.kind === "operator") {
    return (
      <span style={{ color: "var(--tan)" }}>
        Operator change by <Address address={o?.to ?? ""} chain={first.chain} noBalance /> through the Configurator, without a spell
        {beam && <span className="mono text-[11px]" style={dim}> · within BeamState bounds: up to {beam.maxChange === null ? "?" : `${exactAmount(beam.maxChange, 18)}×`} per step, one step per key every {hours(beam.hop)}</span>}
      </span>
    );
  }
  if (g.kind === "relayed") {
    return (
      <h3 className="heading-with-anchor text-[13px]" style={{ color: "var(--tan)" }}>
        Relayed from Ethereum · action set {o?.relay?.actionsSet} on Executor <Address address={o?.relay?.executor ?? ""} chain={first.chain} noBalance />
        <span className="mono text-[11px]" style={dim}> · no bridge message id proves which spell queued it</span>
        {anchor && <HeadingAnchor id={anchor} />}
      </h3>
    );
  }
  return (
    <h3 className="heading-with-anchor text-[13px]" style={{ color: "var(--tan)" }}>
      Direct call by <Address address={o?.from ?? ""} chain={first.chain} noBalance />
      {anchor && <HeadingAnchor id={anchor} />}
    </h3>
  );
}
