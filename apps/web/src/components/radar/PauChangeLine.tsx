import { Address } from "../Address";
import { formatAmount, formatPerDay, limitDecimals, type AtlasKeyRef, type DerivedKey, type PauChange } from "../../lib/pau";
import { LimitName } from "./ActorPauRateLimits";

const dim = { color: "var(--tan-3)" };

/** How a rate-limit key is named: the atlas params that state it, else the controller constant the snapshot derived it from. */
export interface KeyNames {
  keyIndex: Map<string, AtlasKeyRef[]>;
  derived: Map<string, DerivedKey>;
}
const str = (v: unknown) => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));

/** A limit's new maximum and refill, with what it replaced when the history holds the earlier setting. */
function LimitValue({ c }: { c: PauChange }) {
  const max = String(c.args.maxAmount);
  const dec = limitDecimals(undefined, max === "0" && c.before ? String(c.before.maxAmount) : max);
  const was = c.before ? ` (was ${c.before.maxAmount === "0" ? "off" : formatAmount(String(c.before.maxAmount), dec)})` : "";
  if (max === "0") return <span>switched off{was}</span>;
  return (
    <span title="decimals inferred from the limit's size">
      max {formatAmount(max, dec)}{was} · {formatPerDay(String(c.args.slope), dec)} per day
    </span>
  );
}

/** Every argument but the subject, for an event no dedicated line describes. */
const argsText = (c: PauChange) =>
  Object.entries(c.args)
    .filter(([, v]) => str(v) !== c.subject)
    .map(([k, v]) => `${k} ${str(v)}`)
    .join(" · ");
const clip = (t: string) => (t.length > 140 ? `${t.slice(0, 140)}…` : t);

/** One configuration change, in the words of what it set. */
export function PauChangeLine({ c, chain, names }: { c: PauChange; chain: string; names: KeyNames }) {
  if (c.event === "RateLimitDataSet") {
    return (
      <li className="mono text-[10px] break-words" data-event={c.event} style={{ color: "var(--tan-2)" }}>
        <LimitName r={{ key: String(c.subject), derived: names.derived.get(String(c.subject).toLowerCase()) }} chain={chain} keyIndex={names.keyIndex} /> <LimitValue c={c} />
      </li>
    );
  }
  const account = typeof c.args.account === "string" ? c.args.account : null;
  const raw = c.subject === account ? null : c.subject;
  const subject = c.label ?? (raw && raw.length > 20 ? `${raw.slice(0, 10)}…` : raw);
  return (
    <li className="mono text-[10px] break-words" data-event={c.event} style={{ color: "var(--tan-2)" }}>
      {c.event} <span title={c.subject ?? undefined}>{subject}</span>
      {account ? <> <Address address={account} chain={chain} noBalance /></> : <span style={dim} title={argsText(c)}> {clip(argsText(c))}</span>}
      <span style={dim}> on {c.role}</span>
    </li>
  );
}
