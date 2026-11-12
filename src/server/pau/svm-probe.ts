// What the atlas states about a prime's Solana instances that an svm snapshot
// reads live (svm-snapshot.ts): every Integration Account Address, and every
// Underlying Asset Address (a mint, whose Reserve sits at a known address). An
// account the chain says does not exist there is a limit the atlas states and
// the chain never set, as probe.ts finds for an EVM RateLimitID. It reads the
// instances, params and chain the compare does (pauSvm.ts, pauPrimeSources.ts),
// so every account compared is probed, and only an address of 32 bytes: the
// RPC refuses a whole batch over one that is not.
import fs from "node:fs";
import { decodeBase58 } from "../../../scripts/lib/solana-pda.mjs";
import { instanceChain } from "../../lib/pauInstanceChain.ts";
import { isBase58Address, isSvmChain } from "../../lib/pauRegistry.ts";
import { INTEGRATION_PARAM_RE, MINT_PARAM_RE } from "../../lib/pauSvm.ts";

export interface SvmProbe {
  integrations: string[];
  mints: string[];
}

type Params = Record<string, [string, string | null, string?]>;

const isAccount = (v: string) => isBase58Address(v) && decodeBase58(v).length === 32;

const stated = (params: Params, re: RegExp) =>
  Object.entries(params).flatMap(([n, [v]]) => (re.test(n) && isAccount(String(v).trim()) ? [String(v).trim()] : []));

/** Each prime's Solana instances' Integration Account Addresses and mints, from the graph. */
export function atlasSvmProbe(file = "public/graph.json"): Map<string, SvmProbe> {
  const out = new Map<string, SvmProbe>();
  if (!fs.existsSync(file)) return out;
  const graph = JSON.parse(fs.readFileSync(file, "utf8")) as { entities?: { name: string; entity_type: string; meta?: string | object | null }[] };
  for (const e of graph.entities ?? []) {
    if (e.entity_type !== "instance" && e.entity_type !== "invocation") continue;
    const meta = (typeof e.meta === "string" ? JSON.parse(e.meta) : (e.meta ?? {})) as { agent_doc_id?: string; params?: Params };
    const chain = instanceChain({ name: e.name, params: meta.params ?? {} });
    if (!meta.agent_doc_id || !chain || !isSvmChain(chain)) continue;
    const p = out.get(meta.agent_doc_id) ?? { integrations: [], mints: [] };
    p.integrations.push(...stated(meta.params ?? {}, INTEGRATION_PARAM_RE));
    p.mints.push(...stated(meta.params ?? {}, MINT_PARAM_RE));
    out.set(meta.agent_doc_id, { integrations: [...new Set(p.integrations)], mints: [...new Set(p.mints)] });
  }
  return out;
}
