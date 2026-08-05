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
    if (!addr.startsWith("0x") || !CHAIN_RPC[info.chain]) continue;
    if (!byChain.has(info.chain)) byChain.set(info.chain, []);
    byChain.get(info.chain).push(addr);
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
export function applyCodeResults(addresses, addrList, results) {
  let checked = 0;
  let failed = 0;
  let corrected = 0;
  for (let i = 0; i < addrList.length; i++) {
    const r = results[i];
    if (!r?.ok) {
      failed++;
      continue;
    }
    const hasCode = r.code != null && r.code !== "0x" && r.code !== "";
    const entry = addresses[addrList[i]];
    if (entry.isContract !== hasCode) corrected++;
    entry.isContract = hasCode;
    checked++;
  }
  return { checked, failed, corrected };
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
 * Replace every EVM address's `isContract` with the on-chain getCode answer.
 * Mutates `addresses` in place and returns aggregate stats.
 *
 * `clientFor` is injectable so tests can supply a fake without mocking the viem
 * module — only `getCode` is used.
 */
export async function applyOnchainCode(
  addresses,
  { log = console.log, clientFor = defaultClientFor } = {},
) {
  const byChain = planCodeChecks(addresses);
  const totals = { checked: 0, failed: 0, corrected: 0, skipped: 0 };

  for (const [addr, info] of Object.entries(addresses)) {
    if (!addr.startsWith("0x") || !CHAIN_RPC[info.chain]) totals.skipped++;
  }

  for (const [chain, addrList] of byChain) {
    const client = clientFor(chain);
    const results = [];
    for (let i = 0; i < addrList.length; i += BATCH) {
      const slice = addrList.slice(i, i + BATCH);
      results.push(
        ...(await Promise.all(
          slice.map((a) =>
            client
              .getCode({ address: a })
              .then((code) => ({ ok: true, code }))
              .catch(() => ({ ok: false })),
          ),
        )),
      );
    }
    const s = applyCodeResults(addresses, addrList, results);
    totals.checked += s.checked;
    totals.failed += s.failed;
    totals.corrected += s.corrected;
    log(
      `  ${chain.padEnd(12)} ${s.checked} checked` +
      (s.corrected ? `, ${s.corrected} corrected` : "") +
      (s.failed ? `, ${s.failed} RPC failures (kept explorer value)` : ""),
    );
  }
  return totals;
}
