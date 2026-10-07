/**
 * `pnpm pau:candidates [--rpc] [--draft]`: the PAU registry's candidates queue.
 *
 * Compares the curated registry (src/data/pau-registry.json) with what the
 * atlas lists in each Prime agent's PAU address sections, and writes
 * .cache/pau-candidates.{json,md} for the pau-triage skill. It never edits the
 * registry.
 *
 *   --rpc    also read the contracts and check their wiring (public RPCs from
 *            the chain registry; RPC_URL_<CHAIN> overrides), and look up each
 *            RateLimits' live controller from its grant history (explorer
 *            logs: Etherscan v2 with ETHERSCAN_API_KEY, else Blockscout);
 *   --draft  also write .cache/pau-registry.draft.json: the registry plus every
 *            missing observation, for triage to edit down. With --rpc, the
 *            wiring checks run against the draft instead of the registry.
 *
 * Needs the built atlas (pnpm build:index && pnpm build:graph). Exits 0 with
 * findings, like the censuses; exits 1 only when an input is missing.
 */
import fs from "node:fs";
import path from "node:path";
import { validatePauRegistry, type PauRegistry } from "../../src/lib/pauRegistry.ts";
import { CHAIN_ID } from "../lib/chains.mjs";
import { atlasConflicts, missingFromRegistry, staleMembers } from "../lib/pau-diff.ts";
import { discoverPau } from "../lib/pau-discover.ts";
import { draftRegistry } from "../lib/pau-draft.ts";
import { renderCandidates, type CandidatesResult } from "../lib/pau-report.ts";
import { checkRegistryWiring } from "../lib/pau-wiring-check.ts";
import { rpcReader } from "../lib/pau-wiring.ts";
import { explorerLogs } from "../lib/explorer-logs.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const at = (p: string) => path.join(ROOT, p);
export const REGISTRY_PATH = at("src/data/pau-registry.json");

function readJson<T>(rel: string): T {
  const file = at(rel);
  if (!fs.existsSync(file)) {
    console.error(`pau:candidates: ${rel} is missing; run pnpm build:index && pnpm build:graph first`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

/** Verified contract name on one chain, from the committed explorer cache. */
function explorerName(address: string, chain: string): string | undefined {
  const file = at(`.cache/etherscan/${CHAIN_ID[chain]}/${address}.json`);
  if (!CHAIN_ID[chain] || !fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, "utf8")).contractName || undefined;
}

function loadInputs() {
  const docsFile = readJson<{ atlasCommit: string; nodes: Record<string, never> }>("public/docs.json");
  const graph = readJson<{ entities: { id: string; name: string; entity_type: string; subtype: string | null }[] }>("public/graph.json");
  const atlasAddrs = readJson<{ addresses: Record<string, { chain?: string }> }>("public/addresses.atlas.json").addresses;
  const primes = new Map(graph.entities.filter((e) => e.entity_type === "agent" && e.subtype === "prime").map((e) => [e.id, e.name]));
  const registry: PauRegistry = fs.existsSync(REGISTRY_PATH)
    ? JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"))
    : { shared: [], deployments: [], ignored: [] };
  return { docs: docsFile.nodes, atlasCommit: docsFile.atlasCommit, primes, atlasAddrs, registry };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const { docs, atlasCommit, primes, atlasAddrs, registry } = loadInputs();
  const observations = discoverPau({ docs, primes, atlasChain: (a) => atlasAddrs[a]?.chain });
  const draft = args.has("--draft") ? draftRegistry(missingFromRegistry(observations, registry), primes, registry) : null;
  const result: CandidatesResult = {
    atlasCommit,
    registryErrors: validatePauRegistry(registry),
    observations: observations.length,
    missing: missingFromRegistry(observations, registry),
    stale: staleMembers(registry, docs),
    conflicts: atlasConflicts(observations, explorerName),
    wiring: args.has("--rpc") ? await checkRegistryWiring(draft ?? registry, rpcReader(), explorerLogs) : null,
  };
  fs.mkdirSync(at(".cache"), { recursive: true });
  fs.writeFileSync(at(".cache/pau-candidates.json"), JSON.stringify(result, null, 2) + "\n");
  fs.writeFileSync(at(".cache/pau-candidates.md"), renderCandidates(result, docs, primes) + "\n");
  if (draft) fs.writeFileSync(at(".cache/pau-registry.draft.json"), JSON.stringify(draft, null, 2) + "\n");
  const failed = result.wiring?.checks.filter((c) => !c.ok).length;
  console.log(
    `pau:candidates: ${result.observations} observed, ${result.missing.length} missing, ${result.stale.length} stale, ` +
      `${result.conflicts.length} conflicts, ${result.registryErrors.length} registry errors` +
      (result.wiring ? `, ${failed} failed wiring checks, ${result.wiring.proposals.length} on-chain proposals` : "") +
      ` → .cache/pau-candidates.md${draft ? " + .cache/pau-registry.draft.json" : ""}`,
  );
}

if (import.meta.main) await main();
