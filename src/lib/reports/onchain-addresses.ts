import type { ReportMeta } from "./types";

export const onchainAddresses = {
  id: "onchain-addresses",
  title: "On-Chain Addresses",
  description:
    "Every on-chain address the Atlas mentions — with its CHAIN_LOG name, associated owner, chain, type (EOA, Multisig, Token, Sky internal contract, other), and the docs it appears in, with CSV export.",
  group: "onchain",
  provenance: "live",
  scope: { label: "addrs", placeholder: "Filter addresses — address, owner, chainlog, chain, doc" },
  chatTool: "atlas_report_addresses",
} as const satisfies ReportMeta;
