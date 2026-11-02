import { Address } from "../Address";
import type { PauParam } from "../../lib/pau";
import { paramTarget, paramTitle } from "@/lib/pauParamText";
import type { ParamUse } from "@/lib/pauParamUse";
import { paramValue } from "@/lib/pauParamValue";
import { EVM_ADDRESS_EXACT_RE } from "@/lib/patterns";
import { PauOriginChip } from "./PauOriginChip";

const dim = { color: "var(--tan-3)" };
const clip = (v: string) => (v.length > 20 ? `${v.slice(0, 10)}…${v.slice(-6)}` : v);
const text = (v: unknown) => (typeof v === "object" ? JSON.stringify(v) : String(v));

/** What the setting is for: a domain or endpoint in words, an address through Address (its token symbol when read), else the clipped id. */
function Subject({ p, chain, kind }: { p: PauParam; chain: string; kind: string | null }) {
  const target = paramTarget(p.event, p.subject);
  if (target) return <span title={p.subject}>{target}</span>;
  if (!EVM_ADDRESS_EXACT_RE.test(p.subject)) return <span title={p.subject}>{clip(p.subject)}</span>;
  return (
    <>
      <Address address={p.subject} chain={chain} noBalance>
        {p.subjectToken?.symbol ?? undefined}
      </Address>
      {kind && <span style={dim}> {kind}</span>}
    </>
  );
}

/** The event's other arguments: a guard as words, an address through Address, anything else as is; several as "name value". */
function Values({ p, chain }: { p: PauParam; chain: string }) {
  const rest = Object.entries(p.args).filter(([, v]) => String(v) !== p.subject);
  return (
    <>
      {rest.map(([k, v], i) => {
        const shown = paramValue(p, k, text(v));
        return (
          <span key={k} title={shown?.title ?? `${k} ${text(v)}`}>
            {i > 0 && " · "}
            {rest.length > 1 && `${k} `}
            {shown?.kind === "address" ? <Address address={shown.address} chain={chain} noBalance /> : (shown?.text ?? clip(text(v)))}
          </span>
        );
      })}
    </>
  );
}

/** One setting: what it is and what it is for, its value, and when and from where it was set; a guard's title names the rate limits that let it act. */
export function PauParamRow({ p, chain, use }: { p: PauParam; chain: string; use: ParamUse | null }) {
  const title = use?.constants.length ? `${p.event}\nin use by rate limits derived from it: ${use.constants.join(", ")}` : p.event;
  return (
    <li className="mono text-[11px] break-words" style={{ color: "var(--tan-2)" }} title={title} data-use={use?.state}>
      {paramTitle(p.event)} <Subject p={p} chain={chain} kind={use?.kind ?? null} />
      {" → "}
      <Values p={p} chain={chain} />{" "}
      <span style={dim}>set {p.setAt.time.slice(0, 10)}</span> <PauOriginChip chain={chain} tx={p.setAt.tx} />
    </li>
  );
}
