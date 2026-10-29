import { Address } from "../Address";
import { Callout } from "../Callout";
import { exactAmount, formatPerDay, limitDecimals, unitNote, type AtlasKeyRef, type BeamDefault, type BeamLimits } from "../../lib/pau";
import { orderedLimits } from "@/lib/pauLimitOrder";
import { PauLimitName } from "./PauLimitName";
import { PauAmount } from "./PauAmount";
import type { Anchor } from "@/lib/pauAnchors";
import { PauSectionHeading } from "./PauSectionHeading";

const dim = { color: "var(--tan-3)" };
const hours = (seconds: string | null) => (seconds === null ? "?" : `${Math.round((Number(seconds) / 3600) * 100) / 100} h`);
const factor = (wad: string | null) => (wad === null ? "?" : `${exactAmount(wad, 18)}×`);

function DefaultRow({ d, chain, keyIndex }: { d: BeamDefault; chain: string; keyIndex: Map<string, AtlasKeyRef[]> }) {
  const dec = limitDecimals(d.unit, d.maxAmount);
  return (
    <tr className="border-t border-[var(--border)] mono" style={{ color: "var(--tan-2)" }}>
      <td className="py-0.5 pr-3"><PauLimitName r={d} chain={chain} keyIndex={keyIndex} /></td>
      <td className="py-0.5 text-right" title={unitNote(d.unit, d.maxAmount)}><PauAmount raw={d.maxAmount} dec={dec} symbol={d.unit?.symbol} /></td>
      <td className="py-0.5 text-right">{formatPerDay(d.slope, dec)}</td>
      <td className="py-0.5 text-right" style={dim}>{d.scope === "general" ? "all" : "this"}</td>
    </tr>
  );
}

/** What BeamState lets the Configurator do to this RateLimits without a spell, and the default ("init") limits it may set keys up to. */
export function PauBeam({ beam, chain, keyIndex, anchor }: { beam: BeamLimits; chain: string; keyIndex: Map<string, AtlasKeyRef[]>; anchor?: Anchor }) {
  return (
    <div className="mt-3 pau-beam">
      {anchor ? <PauSectionHeading deployment={anchor} section="configurator-limits">Configurator limits</PauSectionHeading> : <h4 className="mono text-[11px] uppercase tracking-wider mb-1" style={dim}>Configurator limits</h4>}
      <Callout>
        <span className="mono text-[11px]" style={dim}>BeamState <Address address={beam.beamState} chain={chain} noBalance /> · </span>
        Without a spell the Configurator may raise a limit to its default or by up to {factor(beam.maxChange)}, once every {hours(beam.hop)} per key, and lower one at any time.{" "}
        {beam.defaults.length === 0 && <span style={dim}>No default limits are set{beam.historyComplete ? "" : " for the keys held here"}.</span>}
      </Callout>
      {beam.defaults.length > 0 && (
        <table className="w-full border-collapse mt-1 text-[12px]">
          <thead>
            <tr className="mono text-[11px] uppercase tracking-wider" style={dim}>
              <th className="text-left font-normal pb-1">Default limit</th>
              <th className="text-right font-normal pb-1 normal-case">maxAmount</th>
              <th className="text-right font-normal pb-1">Slope</th>
              <th className="text-right font-normal pb-1" title="this RateLimits only, or every RateLimits BeamState manages">For</th>
            </tr>
          </thead>
          <tbody>{orderedLimits(beam.defaults, keyIndex, (d) => d.maxAmount === "0").map((d) => <DefaultRow key={d.key} d={d} chain={chain} keyIndex={keyIndex} />)}</tbody>
        </table>
      )}
    </div>
  );
}
