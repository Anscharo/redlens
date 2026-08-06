#!/usr/bin/env node
/**
 * Enriches the atlas-derived address map with Sky chainlog IDs and Etherscan
 * verified contract metadata.
 *
 * Inputs:
 *   public/addresses.merged.json   (intermediate; produced by build-index.mjs)
 *   https://chainlog.skyeco.com/api/mainnet/active.json
 *   Etherscan v2 getsourcecode      (one call per unique non-mainnet+mainnet addr)
 *
 * Outputs:
 *   public/addresses.json           (frontend-visible: labels, roles, no ABIs)
 *   .cache/etherscan/<chainid>/<addr>.json
 *
 * Cache is committed to git so contributors / CI don't need an API key.
 *
 * Run: ETHERSCAN_API_KEY=… node --env-file-if-exists=.env.local scripts/required/build-addresses.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enrichAddresses, fetchImplABIs, fetchChainlog } from "../lib/address-enrich.mjs";
import { applyOnchainCode } from "../lib/address-code.mjs";
import { applySolanaAccounts } from "../lib/solana-accounts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const ATLAS_PATH = path.join(ROOT, "public/addresses.atlas.json");
const OUT_PATH = path.join(ROOT, "public/addresses.json");

const API_KEY = process.env.ETHERSCAN_API_KEY;
if (!API_KEY) {
  console.warn(
    "ETHERSCAN_API_KEY not set — skipping address enrichment. Committed public/addresses.json will be used as-is.\n" +
    "Add it to .env.local to rebuild (build script runs with --env-file-if-exists=.env.local).",
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
let atlas;
try {
  atlas = JSON.parse(await fs.readFile(ATLAS_PATH, "utf8")).addresses;
} catch (err) {
  if (err.code === "ENOENT") {
    console.error("public/addresses.atlas.json not found. Run `pnpm build:index` first.");
    process.exit(1);
  }
  throw err;
}

console.log(`Loaded ${Object.keys(atlas).length} merged atlas addresses`);

const chainlog = await fetchChainlog();

if (!chainlog || Object.keys(chainlog).length === 0) {
  console.error(
    "Chainlog fetch failed or returned empty — refusing to overwrite public/addresses.json.\n" +
    "Doing so would strip every chainlogId and make snap:chainstate write an empty chain-state.json.\n" +
    "Keeping the existing committed artifacts; retry when chainlog.skyeco.com is reachable.",
  );
  process.exit(1);
}

console.log(`Loaded chainlog: ${Object.keys(chainlog).length} mainnet entries`);

const out = await enrichAddresses(atlas, chainlog, API_KEY);
const { misses = 0, errors = 0, proxyRefreshed = 0 } = out.__stats ?? {};

await fetchImplABIs(out, API_KEY);

// isContract is decided by eth_getCode, not by whether the explorer had
// verified source — an unverified contract is still a contract. The probe also
// settles addresses whose doc was ambiguous about the chain, by checking every
// candidate and keeping the ones the address actually exists on.
console.log("\nChecking on-chain bytecode + nonce (eth_getCode / eth_getTransactionCount)…");
const code = await applyOnchainCode(out);

// Solana's equivalent question. getCode has no meaning there — an account's
// owner program and executable flag are what say whether it is a program, a
// program-owned data account, a mint, or a keypair wallet. The atlas labels
// several of these as programs and PDAs, so reading them all as EOAs (which is
// what a missing pass amounts to) is a visible error in the report.
console.log("\nChecking Solana accounts (getMultipleAccounts)…");
const solanaLabels = Object.fromEntries(
  Object.entries(atlas)
    .filter(([, a]) => a.chain === "solana" && a.entityLabel)
    .map(([addr, a]) => [addr, a.entityLabel]),
);
const solana = await applySolanaAccounts(out, { names: solanaLabels });

await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
// addresses.atlas.json is kept as a permanent artifact — not deleted.

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------
const all = Object.values(out);
const withChainlog = all.filter((a) => a.chainlogId).length;
const withEtherscan = all.filter((a) => a.etherscanName).length;
const proxies = all.filter((a) => a.isProxy).length;
const eoas = all.filter((a) => !a.isContract && a.chain !== "solana").length;
// Deployed but with no verified source — invisible to the explorer pass, which
// is why isContract can't be derived from it.
const unverifiedContracts = all.filter((a) => a.isContract && !a.etherscanName).length;
const withLabel = all.filter((a) => a.label).length;
const byChain = {};
for (const a of all) byChain[a.chain] = (byChain[a.chain] ?? 0) + 1;

console.log("\n=== Address build stats ===");
console.log(`Total addresses:    ${all.length}`);
console.log(`Cache misses:       ${misses}`);
console.log(`Errors:             ${errors}`);
console.log(`Proxies re-verified: ${proxyRefreshed}`);
console.log(`With label:         ${withLabel}`);
console.log(`  via chainlog:     ${withChainlog}`);
console.log(`  via etherscan:    ${withEtherscan}`);
console.log(`Proxies:            ${proxies}`);
console.log(`EOAs (no bytecode): ${eoas}`);
console.log(`Contracts, unverified source: ${unverifiedContracts}`);
console.log(`getCode:            ${code.checked} checked, ${code.corrected} corrected, ${code.failed} failed, ${code.skipped} skipped (no RPC)`);
console.log(`Ambiguous chains resolved on-chain: ${code.resolved}`);
console.log(
  `Solana accounts:    ${solana.checked} checked` +
  (solana.failed ? `, ${solana.failed} batch failures (kept previous values)` : ""),
);
for (const [t, n] of Object.entries(solana.byType).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t.padEnd(16)} ${n}`);
}
console.log("By chain:");
for (const [c, n] of Object.entries(byChain).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${c.padEnd(12)} ${n}`);
}
console.log(`\nWrote ${OUT_PATH}`);
