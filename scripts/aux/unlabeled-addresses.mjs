#!/usr/bin/env node
/**
 * Shows all addresses that lack an atlas-derived entityLabel, along with
 * the docs that mention them. Useful for identifying Category C gaps.
 *
 * Run: node scripts/aux/unlabeled-addresses.mjs
 */

import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Merge atlas (annotation) and on-chain files to get full address view
const atlas = JSON.parse(readFileSync(path.join(ROOT, "public/addresses.atlas.json"), "utf8")).addresses;
const onChain = JSON.parse(readFileSync(path.join(ROOT, "public/addresses.json"), "utf8"));
const addrs = {};
for (const [addr, a] of Object.entries(atlas)) {
  const o = onChain[addr] ?? {};
  addrs[addr] = { ...a, ...o, label: o.chainlogId ?? a.entityLabel ?? o.etherscanName ?? null };
}
const docs = JSON.parse(readFileSync(path.join(ROOT, "public/docs.json"), "utf8")).nodes;

// Reverse map: lowercase addr → [{ doc_no, title, type }]
const addrToDocs = new Map();
for (const doc of Object.values(docs)) {
  for (const addr of doc.addressRefs ?? []) {
    const key = addr.toLowerCase();
    if (!addrToDocs.has(key)) addrToDocs.set(key, []);
    addrToDocs.get(key).push({ doc_no: doc.doc_no, title: doc.title, type: doc.type });
  }
}

// Collect unlabeled: no entityLabel, regardless of Etherscan label.
const rows = [];
for (const [addr, info] of Object.entries(addrs)) {
  if (info.entityLabel) continue;
  const mentioning = addrToDocs.get(addr.toLowerCase()) ?? [];
  rows.push({ addr, info, mentioning });
}

// Sort: addresses with mentions first (by doc_no of first mention), then orphans.
rows.sort((a, b) => {
  const aMno = a.mentioning[0]?.doc_no ?? "Z";
  const bMno = b.mentioning[0]?.doc_no ?? "Z";
  return aMno.localeCompare(bMno);
});

// Summary counts
const withEthLabel = rows.filter((r) => r.info.label).length;
const solana = rows.filter((r) => r.info.chain === "solana").length;
const noMentions = rows.filter((r) => r.mentioning.length === 0).length;

console.log(`\nUnlabeled addresses (no entityLabel): ${rows.length} / ${Object.keys(addrs).length}`);
console.log(`  with chainlog/Etherscan label: ${withEthLabel}`);
console.log(`  solana chain:                  ${solana}`);
console.log(`  zero doc mentions:             ${noMentions}`);
console.log();

// Table columns: addr (short), chain, roles, label (etherscan), doc_no — title [type]
const COL = {
  addr: 44,
  chain: 10,
  roles: 30,
  ethLabel: 28,
  docs: 0, // remainder
};

const pad = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
const header = [
  pad("address", COL.addr),
  pad("chain", COL.chain),
  pad("roles", COL.roles),
  pad("etherscan/chainlog label", COL.ethLabel),
  "mentioning docs",
].join(" | ");
console.log(header);
console.log("-".repeat(header.length));

for (const { addr, info, mentioning } of rows) {
  const roles = (info.roles ?? []).join(", ");
  const docsStr = mentioning.length === 0
    ? "(no mentions)"
    : mentioning.map((d) => `${d.doc_no} — ${d.title} [${d.type}]`).join("; ");
  console.log(
    [
      pad(addr, COL.addr),
      pad(info.chain, COL.chain),
      pad(roles, COL.roles),
      pad(info.label ?? "", COL.ethLabel),
      docsStr,
    ].join(" | "),
  );
}
