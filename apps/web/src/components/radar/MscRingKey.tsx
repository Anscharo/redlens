import { DEMAND_SERIES } from "../../lib/settlements";
import { SLICE_CODE, SLICE_TOKEN } from "./MscRingPills";

function Swatch({ background }: { background: string }) {
  return <span className="inline-block w-2 h-2 mr-1 align-middle" style={{ background }} />;
}

function KeyItem({ id, code, label, striped }: { id: string; code?: string; label: string; striped?: boolean }) {
  const color = `var(${SLICE_TOKEN[id] ?? SLICE_TOKEN.kept})`;
  return (
    <span className="msc-key-item" data-key={id}>
      <Swatch
        background={
          striped
            ? `repeating-linear-gradient(45deg, ${color} 0, ${color} 2px, transparent 2px, transparent 4px)`
            : color
        }
      />
      {code ? `${code} · ${label}` : label}
    </span>
  );
}

function KeyGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="msc-key-group">
      <p className="msc-key-title">{title}</p>
      {children}
    </div>
  );
}

/** The chart's key, grouped by where the money goes — the three groups are
 *  the three parts of gross revenue, in the pie's clockwise order — with the
 *  reading guide under a rule. Hovering an item lights every slice it
 *  describes (index.css, keyed on data-key). A row carries a code only when
 *  the code is not the label again ("CoF · cost of funds", never
 *  "kept · supply-side kept"); the supply-side rows name the flow the way
 *  the demand-side heading does. */
export function RingKey({ view = "orbit" }: { view?: "orbit" | "flow" }) {
  const orbit = view === "orbit";
  return (
    <div className="mono text-[10px] mt-5" style={{ color: "var(--tan-3)" }}>
      <div className="msc-key">
        <KeyGroup title="To Sky">
          <KeyItem id="cof" code={SLICE_CODE.cof} label="cost of funds" />
          <KeyItem id="sde" code={SLICE_CODE.sde} label="Sky Direct Exposure" />
        </KeyGroup>
        <KeyGroup title="Supply-side">
          <KeyItem id="kept" label="supply-side kept" />
          <KeyItem id="neg" code="striped" label={orbit ? "supply-side loss (the hole)" : "supply-side loss"} striped />
        </KeyGroup>
        <KeyGroup title="Demand-side">
          {DEMAND_SERIES.map((s) => (
            <KeyItem key={s.key} id={s.key} code={SLICE_CODE[s.key]} label={s.label.toLowerCase()} />
          ))}
        </KeyGroup>
      </div>
      <div className="msc-key-note text-center">
        <p>
          {orbit
            ? "Pie area = gross revenue*. "
            : "A Prime's bar = gross revenue*; ribbons are the money in and out. "}
          Hover for figures; click a Prime for its page.
        </p>
        <p className="mt-1 italic">*Gross revenue = To Sky + supply-side kept + demand-side.</p>
      </div>
    </div>
  );
}
