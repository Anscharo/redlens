/**
 * `eth_getCode` ground truth for whether an address holds bytecode.
 *
 * The explorer pass can only report whether an address has *verified source*,
 * which is a strictly narrower thing: a deployed-but-unverified contract has no
 * `contractName`, and reading that as "no code" mislabels it an EOA. getCode is
 * the actual question, and it needs no API key — just the public RPC already in
 * the chain registry.
 *
 * Chains with no `rpcUrl` (solana) are left alone; their addresses keep
 * whatever the explorer pass decided.
 */

import { createPublicClient, http } from "viem";
import { CHAIN_RPC } from "./chains.mjs";

// Addresses per request. The transport batches JSON-RPC calls, so this bounds
// the payload rather than the number of round trips.
const BATCH = 50;

/**
 * Pure: group the addresses worth checking by chain. An address is worth
 * checking whenever its chain has an RPC — including ones the explorer already
 * verified, because getCode is the field's new definition and a disagreement is
 * worth surfacing rather than hiding behind the explorer's answer.
 */
export function planCodeChecks(addresses) {
  const byChain = new Map();
  for (const [addr, info] of Object.entries(addresses)) {
    if (!addr.startsWith("0x")) continue;
    // Every chain the atlas places the address on, not just the primary — the
    // same address can be a contract on one chain and an EOA on another.
    for (const chain of info.chains?.length ? info.chains : [info.chain]) {
      if (!CHAIN_RPC[chain]) continue;
      if (!byChain.has(chain)) byChain.set(chain, []);
      byChain.get(chain).push(addr);
    }
  }
  return byChain;
}

/**
 * Pure: fold getCode results into a chain's addresses.
 *
 * Results are `{ ok: true, code }` or `{ ok: false }`. The distinction is
 * load-bearing and can't be carried by the raw return value: viem's getCode
 * answers `undefined` for an address with no bytecode, which is exactly what a
 * caught rejection would also produce. A failed call must leave the address on
 * its explorer-derived value rather than silently downgrade a real contract to
 * an EOA on a network blip.
 *
 * Returns counts including how often getCode disagreed with the explorer —
 * i.e. how many addresses were mislabelled.
 */
export function applyCodeResults(addresses, chain, addrList, results) {
  let checked = 0;
  let failed = 0;
  let corrected = 0;
  let present = 0;
  for (let i = 0; i < addrList.length; i++) {
    const r = results[i];
    if (!r?.ok) {
      failed++;
      continue;
    }
    const hasCode = r.code != null && r.code !== "0x" && r.code !== "";
    const entry = addresses[addrList[i]];
    // Per-chain truth. `isContract` stays a single value for the artifact's
    // existing consumers and tracks the address's primary chain.
    (entry.codeByChain ??= {})[chain] = hasCode;
    // "The address really exists here": bytecode, or an EOA that has sent at
    // least one transaction. A nonce of 0 with no code is no evidence — the
    // address is identical on every EVM chain until something happens at it.
    if (hasCode || (r.nonce ?? 0) > 0) {
      (entry.presentOnChains ??= []).push(chain);
      present++;
    }
    const isPrimary = chain === (entry.chain ?? "ethereum");
    if (isPrimary) {
      if (entry.isContract !== hasCode) corrected++;
      entry.isContract = hasCode;
    }
    checked++;
  }
  return { checked, failed, corrected, present };
}

/**
 * Pure: settle each address on the chain the chain data supports.
 *
 * Candidate chains come from ambiguous atlas text — a doc titled for one chain
 * whose body names another. Whichever candidate the address actually exists on
 * is the real one; if several, it is genuinely on several and all are kept. No
 * evidence anywhere leaves the atlas's own answer alone.
 *
 * The atlas primary wins ties so a confirmed reading is never reshuffled.
 */
export function resolvePresentChains(addresses) {
  let resolved = 0;
  for (const info of Object.values(addresses)) {
    const present = info.presentOnChains;
    if (!present?.length) continue;
    if (present.includes(info.chain)) {
      info.presentOnChains = [info.chain, ...present.filter((c) => c !== info.chain)];
    } else {
      // Every candidate the atlas offered is unsupported by chain data, but
      // some other candidate is — take it, and move isContract with it.
      info.chain = present[0];
      info.isContract = info.codeByChain?.[present[0]] ?? info.isContract;
      resolved++;
    }
  }
  return resolved;
}

/** A viem client for one chain's public RPC. */
function defaultClientFor(chain) {
  return createPublicClient({
    transport: http(CHAIN_RPC[chain], {
      timeout: 20_000,
      retryCount: 3,
      retryDelay: 400,
      batch: { batchSize: BATCH, wait: 16 },
    }),
  });
}

/**
 * Probe every candidate chain for each address: `isContract` becomes the
 * eth_getCode answer, and the chains the address demonstrably exists on are
 * recorded so `resolvePresentChains` can settle an ambiguous attribution.
 * Mutates `addresses` in place and returns aggregate stats.
 *
 * `clientFor` is injectable so tests can supply a fake without mocking the viem
 * module — only `getCode` and `getTransactionCount` are used.
 */
export async function applyOnchainCode(
  addresses,
  { log = console.log, clientFor = defaultClientFor } = {},
) {
  const byChain = planCodeChecks(addresses);
  const totals = { checked: 0, failed: 0, corrected: 0, skipped: 0, resolved: 0 };

  for (const [addr, info] of Object.entries(addresses)) {
    const chains = info.chains?.length ? info.chains : [info.chain];
    if (!addr.startsWith("0x") || !chains.some((c) => CHAIN_RPC[c])) totals.skipped++;
  }

  for (const [chain, addrList] of byChain) {
    const client = clientFor(chain);
    const results = [];
    for (let i = 0; i < addrList.length; i += BATCH) {
      const slice = addrList.slice(i, i + BATCH);
      results.push(
        ...(await Promise.all(
          slice.map((a) =>
            // Nonce alongside code so a plain EOA that has transacted still
            // counts as present on the chain. A nonce failure alone is not
            // fatal — code is the primary signal.
            Promise.all([
              client.getCode({ address: a }),
              client.getTransactionCount({ address: a }).catch(() => 0),
            ])
              .then(([code, nonce]) => ({ ok: true, code, nonce: Number(nonce) || 0 }))
              .catch(() => ({ ok: false })),
          ),
        )),
      );
    }
    const s = applyCodeResults(addresses, chain, addrList, results);
    totals.checked += s.checked;
    totals.failed += s.failed;
    totals.corrected += s.corrected;
    log(
      `  ${chain.padEnd(12)} ${s.checked} checked, ${s.present} present` +
      (s.corrected ? `, ${s.corrected} corrected` : "") +
      (s.failed ? `, ${s.failed} RPC failures (kept explorer value)` : ""),
    );
  }
  totals.resolved = resolvePresentChains(addresses);
  return totals;
}
