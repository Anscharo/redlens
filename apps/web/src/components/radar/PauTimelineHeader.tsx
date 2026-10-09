import { Address } from "../Address";
import { SpellLink } from "../SpellLink";
import { exactAmount, type BeamLimits, type TimelineGroup } from "../../lib/pau";

const dim = { color: "var(--tan-3)" };
const hours = (s: string | null) => (s === null ? "?" : `${Math.round((Number(s) / 3600) * 100) / 100} h`);

/** An executive's heading: its vote and spell, or the bare spell when no record titles it. */
function ExecutiveHeading({ g }: { g: TimelineGroup }) {
  const x = g.executive;
  if (!x?.title) {
    return (
      <p className="text-xs" style={{ color: "var(--tan)" }}>
        <SpellLink address={g.spell!} /> <span className="mono text-[10px]" style={dim}>no executive record names this spell</span>
      </p>
    );
  }
  return (
    <>
      <p className="text-xs mono">
        {x.url ? <a href={x.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">Executive Vote {x.date}</a> : <span>Executive Vote {x.date}</span>}
        {" · "}
        <SpellLink address={g.spell!} />
      </p>
      <p className="text-xs leading-relaxed text-tan-2">{x.title}</p>
    </>
  );
}

/** What a group's changes came from, by kind. `beam` gives an operator change its BeamState bounds. */
export function PauTimelineHeader({ g, beam }: { g: TimelineGroup; beam?: BeamLimits }) {
  const first = g.entries[0];
  const o = first.origin;
  if (g.kind === "executive") return <ExecutiveHeading g={g} />;
  if (g.kind === "operator") {
    return (
      <p className="text-xs" style={{ color: "var(--tan)" }}>
        Operator change by <Address address={o?.to ?? ""} chain={first.chain} noBalance /> through the Configurator, without a spell
        {beam && <span className="mono text-[10px]" style={dim}> · within BeamState bounds: up to {beam.maxChange === null ? "?" : `${exactAmount(beam.maxChange, 18)}×`} per step, one step per key every {hours(beam.hop)}</span>}
      </p>
    );
  }
  if (g.kind === "relayed") {
    return (
      <p className="text-xs" style={{ color: "var(--tan)" }}>
        Relayed from Ethereum · action set {o?.relay?.actionsSet} on Executor <Address address={o?.relay?.executor ?? ""} chain={first.chain} noBalance />
        <span className="mono text-[10px]" style={dim}> · no bridge message id proves which spell queued it</span>
      </p>
    );
  }
  if (g.kind === "direct") return <p className="text-xs" style={{ color: "var(--tan)" }}>Direct call by <Address address={o?.from ?? ""} chain={first.chain} noBalance /></p>;
  return <p className="text-xs" style={dim} title={o?.evidence}>Origin not resolved yet</p>;
}
