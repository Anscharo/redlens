import { AtlasLink } from "../AtlasLink";
import type { InstanceParam } from "../../lib/actorIndex";
import { atlasHref } from "@/lib/routes";
import { Address } from "../Address";
import type { AddressInfo } from "@/types";
import { EVM_ADDRESS_EXACT_RE, SOL_ADDRESS_EXACT_RE } from "@/lib/patterns";

// Whole-string address shape tests — sourced from patterns.ts (the src-side
// home for these forms) so this doesn't drift into its own copy.
const EVM_RE = EVM_ADDRESS_EXACT_RE;
const SOL_RE = SOL_ADDRESS_EXACT_RE;
const RATE_LIMIT_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MD_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g;
const PLACEHOLDER_RE = /will be specified in a future iteration/i;

/** Markdown `[text](href)` links inside a param value: a UUID href is an
 * in-app atlas link, anything else opens externally. */
function renderMarkdownLinks(value: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of value.matchAll(MD_LINK_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push(value.slice(last, idx));
    const [, text, href] = m;
    parts.push(UUID_RE.test(href)
      ? <AtlasLink key={idx} to={atlasHref(href)} className="text-accent hover:underline">{text}</AtlasLink>
      : <a key={idx} href={href} target="_blank" rel="noopener" className="text-accent hover:underline">{text}</a>
    );
    last = idx + m[0].length;
  }
  if (last < value.length) parts.push(value.slice(last));
  return <>{parts}</>;
}

function renderValue(
  value: string,
  chainHint?: Array<string | undefined>,
  addrMap?: Record<string, AddressInfo>,
): React.ReactNode {
  if (EVM_RE.test(value) || SOL_RE.test(value)) {
    // addrMap is the build pipeline's resolved chain and outranks every hint —
    // an instance's *name* is not evidence of where it is deployed. The "Grove
    // Arbitrum Governance Relay Receiver" lives on Robinhood Chain, and naming
    // it after the governance it relays sent its address to arbiscan for as
    // long as the name was the only thing consulted.
    return <Address address={value} chain={chainHint} addrMap={addrMap} />;
  }
  if (RATE_LIMIT_HASH_RE.test(value.trim())) {
    const v = value.trim();
    return <span title={v}>{v.slice(0, 10)}…{v.slice(-6)}</span>;
  }
  if (PLACEHOLDER_RE.test(value)) {
    return <span style={{ color: "var(--tan-3)", fontStyle: "italic" }}>To Be Specified</span>;
  }
  if (value.includes("](")) return renderMarkdownLinks(value);
  return value;
}

export function ParamLine({ p, colWidth, instanceHint, addrMap }: { p: InstanceParam; colWidth: number; instanceHint: string; addrMap: Record<string, AddressInfo> }) {
  return (
    <div className="flex py-0.5 w-full items-baseline">
      <span className="mono text-[10px] shrink-0" style={{ color: "var(--tan-3)" }}>
        {p.key}
      </span>
      <span className="flex-1 min-w-0" style={{ borderBottom: "1px dotted color-mix(in srgb, var(--tan-3) 25%, transparent)", margin: "0 4px 3px" }} />
      <span
        className="mono text-[10px] shrink-0 text-right leading-relaxed"
        style={{ maxWidth: `calc(100% - ${colWidth}px)`, wordBreak: "break-word", color: "var(--tan-2)" }}
      >
        {/* Param key first: it's the more specific signal (e.g. "Token Address
            (Avalanche)" on an instance whose name says "Ethereum Mainnet - …"
            names the token's own chain, not the instance's home chain). Falls
            back to the instance name when the key carries no chain hint. */}
        {renderValue(p.value, [p.key, instanceHint], addrMap)}
      </span>
    </div>
  );
}
