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
 * Needs the built atlas (pnpm build:index && pnpm build:graph) and the
 * registry. Exits 0 with findings, like the censuses; exits 1 only when an
 * input is missing. A draft that fails validation (two controllers for one
 * deployment, say) is reported under registry errors with a "draft:" prefix.
 */
import fs from "node:fs";
import path from "node:path";
import { validatePauRegistry, type PauRegistry } from "../../src/lib/pauRegistry.ts";
import { CHAIN_ID } from "../lib/chains.mjs";
import { atlasConflicts, expandPrimeWide, missingFromRegistry, staleMembers } from "../lib/pau-diff.ts";
import { discoverPau } from "../lib/pau-discover.ts";
import { draftRegistry } from "../lib/pau-draft.ts";
import { renderCandidates, type CandidatesResult } from "../lib/pau-report.ts";
import { checkRegistryWiring } from "../lib/pau-wiring-check.ts";
import { rpcReader } from "../lib/pau-wiring.ts";
import { explorerLogs } from "../lib/explorer-logs.ts";

const ROOT = path.resolve(import.meta.dir, "../..");
const at = (p: string) => path.join(ROOT, p);
export const REGISTRY_PATH = at("src/data/pau-registry.json");

const BUILD_HINT = "run pnpm build:index && pnpm build:graph first";

/** A required input; a missing one ends the run (exit 1) rather than reading as empty. */
function readJson<T>(rel: string, hint = BUILD_HINT): T {
  const file = at(rel);
  if (!fs.existsSync(file)) {
    console.error(`pau:candidates: ${rel} is missing; ${hint}`);
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
  // An absent registry would make every observation "missing" and draft a
  // registry with every curated decision gone, so it is required like the rest.
  const registry = readJson<PauRegistry>(path.relative(ROOT, REGISTRY_PATH), "it is the curated registry; restore it from git");
  return { docs: docsFile.nodes, atlasCommit: docsFile.atlasCommit, primes, atlasAddrs, registry };
}

type Inputs = ReturnType<typeof loadInputs>;

/** The queue, the optional draft and, with --rpc, the wiring checks (against the draft when there is one). */
async function buildResult(args: Set<string>, inputs: Inputs) {
  const { docs, atlasCommit, primes, atlasAddrs, registry } = inputs;
  const observations = discoverPau({ docs, primes, atlasChain: (a) => atlasAddrs[a]?.chain });
  const missing = missingFromRegistry(expandPrimeWide(observations, registry), registry);
  const draft = args.has("--draft") ? draftRegistry(missing, primes, registry) : null;
  const draftErrors = draft ? validatePauRegistry(draft).map((e) => `draft: ${e}`) : [];
  const result: CandidatesResult = {
    atlasCommit,
    registryErrors: [...validatePauRegistry(registry), ...draftErrors],
    observations: observations.length,
    missing,
    stale: staleMembers(registry, docs),
    conflicts: atlasConflicts(observations, explorerName),
    wiring: args.has("--rpc") ? await checkRegistryWiring(draft ?? registry, rpcReader(), explorerLogs) : null,
  };
  return { result, draft };
}

function writeOutputs(result: CandidatesResult, draft: PauRegistry | null, inputs: Inputs): void {
  fs.mkdirSync(at(".cache"), { recursive: true });
  fs.writeFileSync(at(".cache/pau-candidates.json"), JSON.stringify(result, null, 2) + "\n");
  fs.writeFileSync(at(".cache/pau-candidates.md"), renderCandidates(result, inputs.docs, inputs.primes) + "\n");
  if (draft) fs.writeFileSync(at(".cache/pau-registry.draft.json"), JSON.stringify(draft, null, 2) + "\n");
}

function summaryLine(result: CandidatesResult, draft: PauRegistry | null): string {
  const counts = [
    `${result.observations} observed`,
    `${result.missing.length} missing`,
    `${result.stale.length} stale`,
    `${result.conflicts.length} conflicts`,
    `${result.registryErrors.length} registry errors`,
  ];
  if (result.wiring) {
    counts.push(`${result.wiring.checks.filter((c) => !c.ok).length} failed wiring checks`);
    counts.push(`${result.wiring.proposals.length} on-chain proposals`);
  }
  return `pau:candidates: ${counts.join(", ")} → .cache/pau-candidates.md${draft ? " + .cache/pau-registry.draft.json" : ""}`;
}

async function main() {
  const inputs = loadInputs();
  const { result, draft } = await buildResult(new Set(process.argv.slice(2)), inputs);
  writeOutputs(result, draft, inputs);
  console.log(summaryLine(result, draft));
}

if (import.meta.main) await main();
