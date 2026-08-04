#!/usr/bin/env bun
/**
 * Chain coverage census — drift detector for the canonical chain registry
 * (scripts/lib/chains.mjs `CHAINS`).
 *
 * The pipeline silently defaults every unrecognized chain to ethereum:
 * `normalizeChainLabel` collapses unknown labels, and `detectChain` is
 * keyword-driven so a chain nobody added to CHAIN_HINTS is invisible *by
 * construction*. Both failures are silent — an address on a new chain gets an
 * etherscan.io link and an ethereum chainId with no error anywhere. This census
 * is the alarm for that. (Robinhood Chain is the worked example: two `Network`
 * params named it while the registry had never heard of it.)
 *
 * Two independent halves:
 *
 *   labels     — the explicit chain strings the real extractors read:
 *                `Token Address (X)` titles, `Network` / `Integration Partner
 *                Chain` param docs, and the multisig `address of ... on X is`
 *                prose regex (plus a bare `Chain` title the pipeline does not
 *                yet consume — see CHAIN_PARAM_TITLE_RE). Each raw string goes
 *                through classifyChainLabel, so this measures close to exactly
 *                "a label the pipeline is about to collapse to ethereum".
 *   candidates — an inverted prose scan for `<Proper Noun> Chain|Network|
 *                Mainnet|Rollup|L2|L1`, minus the registry. Deliberately not a
 *                list of chain names someone thought of ahead of time: a drift
 *                detector built from known names cannot detect drift.
 *
 * Both halves bucket into known / deferred (FUTURE_TO_ETHEREUM, an intentional
 * collapse) / unknown. Unknown is the residue — the watch list, keyed by the
 * chain string rather than per-doc, since the string is the unit of drift.
 * Atlas prose noise ("Pioneer Chain", "Partner Network") lands there on the
 * first --update and stays absorbed; that is the design working, not a bug.
 *
 * Also asserts the registry's four parallel lists stay in step — CHAINS,
 * CHAIN_HINTS (address-chains.mjs), EXPLORER (src/lib/explorer.ts), and the
 * chainId/rpcUrl fields. A half-added chain is a code bug, not atlas drift, so
 * those warnings are never baselined.
 *
 * Runs under bun (not node) so it can import EXPLORER straight from the
 * TypeScript module the frontend uses, rather than re-declaring it.
 *
 * Warnings (stderr, picked up by atlas-update.yml's drift-issue step):
 *   - [drift] a chain string entered the residue that isn't in the committed
 *     baseline (.github/chains-census-baseline.json)
 *   - [drift] a registry inconsistency (never baselined)
 *
 * Always exits 0 — like the other censuses, it must never block a build.
 * `--update` rewrites the baseline (atlas-update.yml does this in the same
 * commit as the submodule bump).
 * `--rpc` additionally round-trips eth_chainId against every registry rpcUrl
 * and checks it matches the declared chainId. Opt-in: it needs network access,
 * so it is not part of the default (offline, deterministic) run.
 */

import fs from "node:fs";
import path from "node:path";
import { CHAINS, FUTURE_TO_ETHEREUM, classifyChainLabel } from "../lib/chains.mjs";
import { CHAIN_HINTS } from "../lib/address-chains.mjs";
import { EXPLORER } from "../../src/lib/explorer.ts";
import { naturalCompare } from "../lib/natural-sort.mjs";

const ROOT = path.resolve(import.meta.dir, "../..");
const BASELINE_PATH = path.join(ROOT, ".github/chains-census-baseline.json");
const update = process.argv.includes("--update");
const checkRpc = process.argv.includes("--rpc");

const docs = JSON.parse(fs.readFileSync(path.join(ROOT, "public/docs.json"), "utf8")).nodes;
const allDocs = Object.values(docs);

// ---------------------------------------------------------------------------
// Observation collection
//
// One observation = one raw chain string seen at one doc. Keyed later by the
// lowercased string so the residue is per-chain-name, not per-mention.
// ---------------------------------------------------------------------------
const observations = [];
const observe = (raw, source, doc) => {
  const label = String(raw ?? "").trim();
  if (label) observations.push({ label, source, doc });
};

// -- Half 1: the explicit labels the real extractors read ---------------------

// build-graph.mjs icdParamChain: the `Token Address (X)` parenthetical. The
// ERC4626 marker is a vault-type flag, not a chain — icdParamChain skips it.
const TOKEN_ADDRESS_RE = /^Token Address \(([^)]+)\)/;
// build-graph.mjs icdParamChain reads `Network` and `Integration Partner Chain`.
// A bare `Chain` title is *not* read by the pipeline — it's included here as a
// forward-looking near-miss the atlas could plausibly adopt, so the census
// surfaces it early. Note the asymmetry: a `Chain` param naming a known chain
// still buckets `known` even though nothing consumes it.
const CHAIN_PARAM_TITLE_RE = /^(?:Network|Integration Partner Chain|Chain)$/i;
// graph-multisigs.mjs ADDRESS_CHAIN_RE, made global to sweep every doc.
const ADDRESS_CHAIN_RE = /\baddress of .+? on (?:the )?([A-Z][\w ]*?) is/g;

for (const doc of allDocs) {
  const title = doc.title ?? "";
  const content = doc.content ?? "";

  const tokenMatch = title.match(TOKEN_ADDRESS_RE);
  if (tokenMatch && !/ERC4626/i.test(tokenMatch[1])) {
    observe(tokenMatch[1], "token-address-param", doc);
  }

  if (CHAIN_PARAM_TITLE_RE.test(title)) {
    // Param docs hold a single value; take the first non-empty line, matching
    // how extractInstanceParams flattens a leaf.
    const value = content.trim().split("\n")[0]?.trim();
    // Prose-y `Integration Partner Chain` bodies ("The Aave Integration Boost
    // is on the Ethereum...") are sentences, not labels — the substring match
    // in classifyChainLabel still resolves them, so pass them through as-is.
    observe(value, "chain-param", doc);
  }

  for (const m of content.matchAll(ADDRESS_CHAIN_RE)) {
    observe(m[1], "multisig-prose", doc);
  }
}

// -- Half 2: inverted prose scan ---------------------------------------------
// Anchored on the chain word *trailing* the proper noun. The atlas's own noise
// runs the other way ("Chain Primitive", "Chainlog", "Chainlink"), so this
// anchor sidesteps it: `<Word> Chain` is nearly all real chain talk.
const PROSE_CHAIN_RE =
  /\b([A-Z][A-Za-z0-9-]{2,})\s+(?:Chain|Network|Mainnet|Rollup|L2|L1)\b/g;

for (const doc of allDocs) {
  const haystack = `${doc.title ?? ""}\n${doc.content ?? ""}`;
  for (const m of haystack.matchAll(PROSE_CHAIN_RE)) {
    observe(m[1], "prose", doc);
  }
}

// ---------------------------------------------------------------------------
// Bucket by classification, grouped on the chain string
// ---------------------------------------------------------------------------
const counts = { total: observations.length, known: 0, deferred: 0, unknown: 0, empty: 0 };
/** key = lowercased label → { label, kind, chain, sources, docs[], count } */
const byLabel = new Map();

for (const obs of observations) {
  const c = classifyChainLabel(obs.label);
  counts[c.kind]++;
  if (c.kind === "empty") continue;

  const key = obs.label.toLowerCase();
  let entry = byLabel.get(key);
  if (!entry) {
    entry = { label: obs.label, kind: c.kind, chain: c.chain, sources: new Set(), docs: [], count: 0 };
    byLabel.set(key, entry);
  }
  entry.count++;
  entry.sources.add(obs.source);
  entry.docs.push(obs.doc);
}

const toRow = (entry) => ({
  label: entry.label,
  sources: [...entry.sources].sort(),
  count: entry.count,
  // A couple of doc_no-sorted examples for human context. Recorded as UUIDs
  // (stable identity) with doc_no alongside for readability only.
  examples: [...entry.docs]
    .sort((a, b) => naturalCompare(a.doc_no, b.doc_no))
    .filter((d, i, xs) => xs.findIndex((x) => x.id === d.id) === i)
    .slice(0, 3)
    .map((d) => ({ uuid: d.id, doc_no: d.doc_no, title: d.title })),
});

const rows = [...byLabel.values()];
const residue = rows
  .filter((e) => e.kind === "unknown")
  .sort((a, b) => naturalCompare(a.label, b.label))
  .map(toRow);
const deferred = rows
  .filter((e) => e.kind === "deferred")
  .sort((a, b) => naturalCompare(a.label, b.label))
  .map(toRow);
const known = rows
  .filter((e) => e.kind === "known")
  .sort((a, b) => naturalCompare(a.label, b.label));

// ---------------------------------------------------------------------------
// Registry consistency — the four parallel lists must stay in step
// ---------------------------------------------------------------------------
let registryDrift = 0;
const registryWarn = (msg) => {
  console.warn(`[drift] chains-census: ${msg}`);
  registryDrift++;
};

const chainKeys = new Set(CHAINS.map((c) => c.chain));
const hintChains = new Set(CHAIN_HINTS.map((h) => h.chain));

for (const c of CHAINS) {
  if (!EXPLORER[c.chain]) {
    registryWarn(`chain "${c.chain}" is in CHAINS but has no EXPLORER entry (src/lib/explorer.ts) — its addresses would link to etherscan.io.`);
  }
  // Solana is the one intentional non-EVM entry: no chainId, no EVM rpcUrl,
  // and no CHAIN_HINTS entry either — detectChain only ever runs on EVM
  // (ETH_ADDR_RE) matches, and solana addresses are attributed by their base58
  // shape (SOL_ADDR_RE) instead. Every EVM chain does need a hint.
  const isEvm = c.chain !== "solana";
  if (isEvm && !hintChains.has(c.chain)) {
    registryWarn(`chain "${c.chain}" is in CHAINS but has no CHAIN_HINTS entry (scripts/lib/address-chains.mjs) — detectChain can never attribute a prose address to it.`);
  }
  if (isEvm && c.chainId == null) registryWarn(`chain "${c.chain}" has no chainId in CHAINS.`);
  if (isEvm && !c.rpcUrl) registryWarn(`chain "${c.chain}" has no rpcUrl in CHAINS — it cannot be queried on-chain.`);
  if (!isEvm && c.rpcUrl) registryWarn(`chain "${c.chain}" is non-EVM but declares an rpcUrl.`);
}
for (const key of Object.keys(EXPLORER)) {
  if (!chainKeys.has(key)) registryWarn(`EXPLORER has "${key}" but CHAINS does not — the frontend knows a chain the build pipeline doesn't.`);
}
for (const h of hintChains) {
  if (!chainKeys.has(h)) registryWarn(`CHAIN_HINTS has "${h}" but CHAINS does not — detectChain can emit a chain with no chainId or explorer.`);
}
for (const f of FUTURE_TO_ETHEREUM) {
  if (chainKeys.has(f)) registryWarn(`"${f}" is in both CHAINS and FUTURE_TO_ETHEREUM — remove it from FUTURE_TO_ETHEREUM now that it is fully supported.`);
}

// ---------------------------------------------------------------------------
// Compare residue against baseline → [drift] warnings for new chain strings
// ---------------------------------------------------------------------------
let baselineLabels = null;
try {
  baselineLabels = new Set(
    JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")).residue.map((r) => r.label.toLowerCase()),
  );
} catch {
  console.warn("[chains-census] no baseline found — run with --update to create it");
}

let drift = 0;
if (baselineLabels) {
  for (const r of residue) {
    if (!baselineLabels.has(r.label.toLowerCase())) {
      const ex = r.examples[0];
      console.warn(
        `[drift] chains-census: NEW unrecognized chain string "${r.label}" ` +
          `(${r.count} mention(s), source: ${r.sources.join("+")}, e.g. ${ex?.doc_no} "${ex?.title}" ${ex?.uuid}). ` +
          `If it is a real chain, add it to CHAINS in scripts/lib/chains.mjs (chainId + rpcUrl) plus ` +
          `CHAIN_HINTS in scripts/lib/address-chains.mjs and EXPLORER in src/lib/explorer.ts; ` +
          `if it is not yet live, add it to FUTURE_TO_ETHEREUM; otherwise --update the baseline.`,
      );
      drift++;
    }
  }
  const resolved = [...baselineLabels].filter(
    (l) => !residue.some((r) => r.label.toLowerCase() === l),
  ).length;
  if (resolved) console.log(`chains-census: ${resolved} baseline residue string(s) resolved (now recognized or gone)`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
console.log(
  `chains-census: ${counts.total} chain mention(s) — ${counts.known} known, ` +
    `${counts.deferred} deferred, ${counts.unknown} unknown, ${counts.empty} empty; ` +
    `${residue.length} residue string(s), ${drift + registryDrift} drift warning(s)`,
);
// Many labels can resolve to one chain ("Ethereum Mainnet", "Ethereum") — report
// the distinct set.
const seenChains = [...new Set(known.map((k) => k.chain))].sort();
console.log(`  registry: ${CHAINS.length} chains — ${seenChains.length} seen in this atlas build (${seenChains.join(", ")})`);
const unseen = [...chainKeys].filter((k) => !seenChains.includes(k)).sort();
if (unseen.length) console.log(`  in registry but not seen in this atlas build: ${unseen.join(", ")}`);
for (const d of deferred) {
  console.log(`  deferred → ethereum: "${d.label}" (${d.count} mention(s)) — promote to CHAINS when it goes live`);
}

// ---------------------------------------------------------------------------
// Opt-in live RPC verification (--rpc)
// ---------------------------------------------------------------------------
if (checkRpc) {
  console.log("chains-census: verifying rpcUrl endpoints (eth_chainId)…");
  for (const c of CHAINS) {
    if (!c.rpcUrl) continue;
    try {
      const res = await fetch(c.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
        signal: AbortSignal.timeout(15000),
      });
      const got = parseInt((await res.json()).result, 16);
      if (got === c.chainId) console.log(`  ok   ${c.chain} → ${got} (${c.rpcUrl})`);
      else registryWarn(`rpcUrl for "${c.chain}" reports chainId ${got}, registry says ${c.chainId} — ${c.rpcUrl}`);
    } catch (err) {
      registryWarn(`rpcUrl for "${c.chain}" is unreachable (${err.message}) — ${c.rpcUrl}`);
    }
  }
}

if (update) {
  fs.writeFileSync(BASELINE_PATH, JSON.stringify({ residue }, null, 2) + "\n");
  console.log(`chains-census: baseline written → ${path.relative(ROOT, BASELINE_PATH)}`);
}
