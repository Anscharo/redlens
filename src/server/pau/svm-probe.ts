// What the atlas states about a prime's Solana instances that an svm snapshot
// reads live (svm-snapshot.ts): every Integration Account Address, and every
// Underlying Asset Address (a mint, whose Reserve sits at a known address). An
// account the chain says does not exist there is a limit the atlas states and
// the chain never set, as probe.ts finds for an EVM RateLimitID.
import fs from "node:fs";
import { chainOfLabel } from "../../lib/pauInstanceChain.ts";
import { isSvmChain } from "../../lib/pauRegistry.ts";

export interface SvmProbe {
  integrations: string[];
  mints: string[];
}

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
type Params = Record<string, [string, string?]>;

/** The chain an instance names: its Network param, else its name's "<Chain> - " prefix. */
const chainOf = (name: string, params: Params) => chainOfLabel(params.Network?.[0] ?? "") ?? (name.includes(" - ") ? chainOfLabel(name.split(" - ")[0]) : null);

const stated = (params: Params, re: RegExp) =>
  Object.entries(params).flatMap(([n, [v]]) => (re.test(n) && BASE58_RE.test(String(v).trim()) ? [String(v).trim()] : []));

/** Each prime's Solana instances' Integration Account Addresses and mints, from the graph. */
export function atlasSvmProbe(file = "public/graph.json"): Map<string, SvmProbe> {
  const out = new Map<string, SvmProbe>();
  if (!fs.existsSync(file)) return out;
  const graph = JSON.parse(fs.readFileSync(file, "utf8")) as { entities?: { name: string; entity_type: string; meta?: string | object | null }[] };
  for (const e of graph.entities ?? []) {
    if (e.entity_type !== "instance") continue;
    const meta = (typeof e.meta === "string" ? JSON.parse(e.meta) : (e.meta ?? {})) as { agent_doc_id?: string; params?: Params };
    const chain = chainOf(e.name, meta.params ?? {});
    if (!meta.agent_doc_id || !chain || !isSvmChain(chain)) continue;
    const p = out.get(meta.agent_doc_id) ?? { integrations: [], mints: [] };
    p.integrations.push(...stated(meta.params ?? {}, /integration account address/i));
    p.mints.push(...stated(meta.params ?? {}, /underlying asset address/i));
    out.set(meta.agent_doc_id, { integrations: [...new Set(p.integrations)], mints: [...new Set(p.mints)] });
  }
  return out;
}
