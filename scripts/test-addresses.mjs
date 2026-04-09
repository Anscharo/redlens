#!/usr/bin/env node
/**
 * Regression test for public/addresses.json.
 *
 * Asserts that known token-bearing addresses have the expected metadata.
 * Each case was manually verified against the Sky Atlas source — these are
 * addresses where any reader can clearly tell what tokens are involved.
 *
 * Run:  node scripts/test-addresses.mjs
 * (No build step required — reads the already-built public/addresses.json)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const addrs = JSON.parse(fs.readFileSync(path.join(ROOT, "public/addresses.json"), "utf8"));

// ---------------------------------------------------------------------------
// Test cases
//
// Each case specifies the address and the minimum metadata we expect.
// "tokens" is a list of expectedTokens that MUST be present (subset check).
// "roles"  is a list of role tags that MUST be present (subset check).
// "label"  if provided, the resolved label must equal this value exactly.
// "hasLabel" if true, label must be non-null.
// ---------------------------------------------------------------------------
const CASES = [
  // --- Token contracts (the address IS the token) ---
  {
    addr: "0xc20059e0317de91738d13af027dfc4a50781b066",
    desc: "SPK token contract",
    label: "SPK",
    tokens: ["SPK"],
  },
  {
    addr: "0x6b175474e89094c44da98b954eedeac495271d0f",
    desc: "DAI token contract",
    hasLabel: true,
    tokens: ["DAI"],
  },
  {
    addr: "0xdc035d45d973e3ec169d2276ddab16f1e407384f",
    desc: "USDS token contract",
    hasLabel: true,
    tokens: ["USDS"],
  },
  {
    addr: "0x56072c95faa701256059aa122697b133aded9279",
    desc: "SKY token contract",
    hasLabel: true,
    tokens: ["SKY"],
  },

  // --- Contracts that hold or distribute specific tokens ---
  {
    addr: "0x35d1b3f3d7966a1dfe207aa4514c12a259a0492b",
    desc: "MCD_VAT — core accounting for DAI/USDS",
    label: "MCD_VAT",
    tokens: ["DAI", "USDS"],
  },
  {
    addr: "0x81efc7dd25241acd8e5620f177e42f4857a02b79",
    desc: "MCD_BLOW2 — accepts DAI or USDS, sends to Surplus Buffer",
    label: "MCD_BLOW2",
    tokens: ["DAI", "USDS"],
  },
  {
    addr: "0xb44c2fb4181d7cb06bdff34a46fdfe4a259b40fc",
    desc: "REWARDS_LSSKY_SKY — staking rewards contract, distributes SKY and USDS",
    label: "REWARDS_LSSKY_SKY",
    tokens: ["SKY", "USDS"],
    roles: ["staking-rewards"],
  },
  {
    addr: "0x675671a8756ddb69f7254afb030865388ef699ee",
    desc: "REWARDS_DIST_LSSKY_SKY — rewards distribution contract for SKY",
    label: "REWARDS_DIST_LSSKY_SKY",
    tokens: ["SKY"],
  },

  // --- Wallets/multisigs that hold specific tokens ---
  {
    addr: "0x14d98650d46bf7679bbd05d4f615a1547c87bf68",
    desc: "Accessibility Campaigns multisig — holds 27M+ SKY",
    tokens: ["SKY"],
    roles: ["multisig"],
  },
  {
    addr: "0x849d52316331967b6ff1198e5e32a0eb168d039d",
    desc: "USDS payment recipient — receives 1,806,670 USDS",
    tokens: ["USDS"],
  },

  // --- Spark SubProxy — referenced in SPK genesis context ---
  {
    addr: "0x3300f198988e4c9c63f75df86de36421f06af8c4",
    desc: "SPARK_SUBPROXY — holds SPK admin rights",
    label: "SPARK_SUBPROXY",
    tokens: ["SPK"],
    roles: ["spark", "subproxy"],
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const failures = [];

for (const c of CASES) {
  const info = addrs[c.addr.toLowerCase()];
  const errs = [];

  if (!info) {
    errs.push("address not present in addresses.json");
  } else {
    if (c.label !== undefined && info.label !== c.label) {
      errs.push(`label: got "${info.label}", want "${c.label}"`);
    }
    if (c.hasLabel && !info.label) {
      errs.push("label: expected non-null, got null");
    }
    for (const tok of c.tokens ?? []) {
      if (!info.expectedTokens.includes(tok)) {
        errs.push(`expectedTokens: missing "${tok}" (got [${info.expectedTokens.join(", ")}])`);
      }
    }
    for (const role of c.roles ?? []) {
      if (!info.roles.includes(role)) {
        errs.push(`roles: missing "${role}" (got [${info.roles.join(", ")}])`);
      }
    }
  }

  if (errs.length === 0) {
    passed++;
    console.log(`  ✓  ${c.desc}`);
  } else {
    failed++;
    console.log(`  ✗  ${c.desc}`);
    for (const e of errs) console.log(`       ${e}`);
    failures.push({ ...c, errs });
  }
}

console.log(`\n${passed + failed} cases — ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
