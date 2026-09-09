// Curated On-Chain Addresses report. Backend port of the /reports/onchain-addresses
// page: merges addresses.atlas.json (atlas-derived) with addresses.json
// (on-chain, not atlas-versioned) via the same rules the frontend uses
// (src/lib/addressMerge.ts), joins live doc mentions, and reads the SAME cached
// balances the page shows (src/server/balances/balances.ts) — never triggers a
// refresh itself, since that stays a user-initiated action on the page.
import type { Indexes } from "../retrieval/indexes.ts";
import type { ToolResult } from "../chat/tools/tools.ts";
import { config } from "../config.ts";
import { fitToBudget, TRUNCATION_HINT } from "../chat/output-budget.ts";
import { mergeAddressInfo, type AtlasAddr, type OnChainAddr } from "../../lib/addressMerge.ts";
import { buildOnchainAddressRows, addrSearchFields, type OnchainAddressRow } from "../../lib/onchainAddressesIndex.ts";
import type { AddressBalances } from "../../lib/balances.ts";
import { readCache } from "../balances/balances.ts";
import { indexesToDocs } from "./ix-adapter.ts";
import { applyReportFilter } from "./report-filter.ts";
import { readPublicJson } from "./util.ts";

// Every mentioning doc is the provenance layer here — can be long for a
// heavily-referenced address (e.g. the surplus buffer). Drop it for the
// leaner (include_provenance:false) rollup down to a count; the resolved
// chain/type/owner/balances fields stay.
function stripRowProvenance(r: OnchainAddressRow): OnchainAddressRow & { docCount?: number } {
  const { docs, ...rest } = r;
  return { ...rest, docs: [], docCount: docs.length };
}

// Reads the same balances cache /api/balances GET serves — never queries the
// chain itself.
async function loadCachedBalances(): Promise<Record<string, AddressBalances>> {
  return (await readCache(false)).addresses;
}

export async function buildOnchainAddressesReport(
  ix: Indexes,
  opts: { include_provenance: boolean; filter?: string },
  publicDir: string = config.publicDir,
  loadBalances: () => Promise<Record<string, AddressBalances>> = loadCachedBalances,
): Promise<ToolResult> {
  const atlasAddrs = readPublicJson<{ addresses: Record<string, AtlasAddr> }>("addresses.atlas.json", publicDir)?.addresses ?? {};
  const onChainAddrs = readPublicJson<Record<string, OnChainAddr>>("addresses.json", publicDir) ?? {};
  const addrMap = mergeAddressInfo(atlasAddrs, onChainAddrs);
  // A DB outage degrades to "no balances" rather than failing the whole
  // report: every other field (chain, type, roles, docs) still answers.
  const balances = await loadBalances().catch(() => ({}) as Record<string, AddressBalances>);

  const allRows = buildOnchainAddressRows(indexesToDocs(ix), addrMap, balances);
  const matched = applyReportFilter(allRows, opts.filter, addrSearchFields);
  const rows = opts.include_provenance ? matched : matched.map(stripRowProvenance);

  const { kept, truncated } = fitToBudget(rows);
  const result: ToolResult = {
    report: "onchain_addresses",
    total: matched.length,
    returned: kept.length,
    truncated,
    addresses: kept,
  };
  if (truncated) result.note = TRUNCATION_HINT;
  return result;
}
