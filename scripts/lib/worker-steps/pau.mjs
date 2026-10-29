// PAU admin events and live state (src/server/pau/). Events are read under a
// per-tick time budget, so a cold database backfills over several ticks; the
// snapshots rebuild only past PAU_REFRESH_SECONDS. Both read only the
// contracts listed in src/data/pau-registry.json. A rebuild names each
// rate-limit key by what derives it in its generation (diamond-derive.ts): a
// monolithic constant from the cached ABIs, or a key getter of a facet the
// diamond integrates, hashed against the published address artifacts,
// the naming material of the cached sources and of the spells the
// pau-spell-sources step stored (LIMIT_* names, address and bytes32
// constants), and the addresses the atlas's history listed and its current
// commit does not (a key from one of those is marked retired),
// reads the token each key is counted in (units.ts), reads what the chain's
// BeamState lets the Configurator set without a spell (beam.ts), and reads
// every RateLimitID the atlas states live on its prime's RateLimits, so a key
// is called unset only when the contract says so (probe.ts). The atlas
// artifacts it reads come from the published set (atlas-inputs.ts), because
// this step runs before the worker builds anything.
import fs from "node:fs";
import { SUBMODULE } from "../worker-proc.mjs";

function summary(ev, st) {
  const errors = ev.errors ? `, ${ev.errors} error(s)` : "";
  const limited = ev.rateLimited.length ? ` (explorer rate limit: ${ev.rateLimited.join(", ")})` : "";
  const state = st.reason === "due" ? `rebuilt ${st.refreshed}` : "fresh";
  const dropped = st.removed ? `, dropped ${st.removed}` : "";
  const failed = st.failed?.length ? `, ${st.failed.length} kept their last snapshot` : "";
  return `pau events ${ev.visited} read, ${ev.pending} pending, ${ev.events} new${errors}${limited}; state ${state}${dropped}${failed}`;
}

/**
 * The atlas artifacts a rebuild reads, fetched once and only when one is due. A
 * failed store read falls back to public/; an artifact found nowhere is warned
 * about, since whatever it feeds is then left out.
 */
function atlasInputsOnce(db, warn) {
  let inputs;
  const load = async () => {
    const { pauAtlasInputs, publicInputs } = await import("../../../src/server/pau/atlas-inputs.ts");
    const paths = await pauAtlasInputs(db).catch((e) => {
      warn(`atlas-worker: pau published atlas artifacts not read, reading public/: ${e.message}`);
      return publicInputs();
    });
    for (const p of Object.values(paths)) if (!fs.existsSync(p)) warn(`atlas-worker: pau has no ${p} (not published, not built)`);
    return paths;
  };
  return () => (inputs ??= load());
}

/** The atlas clone's retired addresses (the worker image clones it with its full history), read when the namer first needs them; a git failure warns and retires none. */
async function retiredReader(warn) {
  const { atlasRetiredAddresses } = await import("../../../src/server/pau/retired-addresses.ts");
  return () => {
    try {
      return atlasRetiredAddresses(SUBMODULE);
    } catch (e) {
      warn(`atlas-worker: pau retired atlas addresses not read, keys derived from them stay unmarked: ${e.message}`);
      return new Map();
    }
  };
}

/** The naming material of the spells the pau-spell-sources step has read; a failed read warns and adds none. */
async function storedSpellMaterial(db, warn) {
  const { spellMaterial } = await import("../../../src/server/pau/spell-sources.ts");
  try {
    return await spellMaterial(db);
  } catch (e) {
    warn(`atlas-worker: pau spell sources not read, keys only they name stay unnamed: ${e.message}`);
    return { names: [], addresses: [], words: [], spells: [] };
  }
}

export default {
  id: "pau",
  phase: "tick",
  label: "pau step",
  skipWhenNoFetch: "pau skipped (--no-fetch) — it reads block explorers and RPCs",
  async run({ db, warn }) {
    const { config } = await import("../../../src/server/config.ts");
    const { default: reg } = await import("../../../src/data/pau-registry.json", { with: { type: "json" } });
    const { syncPauEvents } = await import("../../../src/server/pau/sync-events.ts");
    const { maybeRefreshPauState } = await import("../../../src/server/pau/store.ts");
    const { rpcChainReader, rpcHead } = await import("../../../src/server/pau/rpc-reader.ts");
    const { explorerLogs } = await import("../explorer-logs.ts");
    const { logsRpcsFor } = await import("../rpc-logs.ts");
    const { rpcChains } = await import("../../../src/server/pau/rpc-sync.ts");
    const { keyNamer } = await import("../../../src/server/pau/diamond-derive.ts");
    const { atlasKeysByPrime } = await import("../../../src/server/pau/probe.ts");
    // Chains read over JSON-RPC belong to the sync:pau-rpc tail; this step leaves their cursors alone.
    const skipChains = rpcChains(reg, logsRpcsFor);
    const ev = await syncPauEvents(db, reg, { logs: explorerLogs, head: rpcHead, budgetMs: config.pauEventBudgetSeconds * 1000, skipChains });
    const material = await storedSpellMaterial(db, warn);
    const retired = await retiredReader(warn);
    const inputs = atlasInputsOnce(db, warn);
    let namer;
    const nameKeys = async (...a) => (namer ??= keyNamer([(await inputs())["addresses.atlas.json"], "public/addresses.json"], reg, { retired, material }))(...a);
    const atlasKeys = async () => atlasKeysByPrime((await inputs())["graph.json"]);
    const st = await maybeRefreshPauState(db, reg, rpcChainReader(), { refreshSeconds: config.pauRefreshSeconds, nameKeys, atlasKeys });
    for (const f of st.failed ?? []) warn(`atlas-worker: pau snapshot ${f.deployment} not rebuilt, keeping its last: ${f.error}`);
    return summary(ev, st);
  },
};
