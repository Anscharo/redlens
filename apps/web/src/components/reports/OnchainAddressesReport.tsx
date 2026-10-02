import type { ReportMode } from "@/lib/reportFilter";
import type { ReportId } from "@/types";
import { ReportShell } from "./ReportShell";
import { OnchainAddressesTable } from "./OnchainAddressesTable";
import { OnchainAddressControls, OnchainAddressesCsvButton } from "./OnchainAddressControls";
import { OnchainBalanceAge, OnchainBalanceRefresh } from "./OnchainBalanceStatus";
import { useOnchainAddressesState } from "./useOnchainAddressesState";

const REPORT: ReportId = "onchain-addresses";

const SEARCHES =
  "address · chainlog name · on-chain name · implementation · owner · chain · type · roles · aliases · expected tokens · doc nos · doc titles";

function OnchainAddressesIntro({ rowCount }: { rowCount: number }) {
  return (
    <>
      Every on-chain address the Atlas mentions — with its CHAIN_LOG name, associated owner, chain, type,
      and the docs it appears in, including docs that name a contract only by its chainlog key (tagged{" "}
      <span className="mono text-tan-3">chainlog name</span>) without its address. The Atlas assigns each
      address a single canonical chain, so an address used on more than one chain lists all its mentions on
      one row. On-chain ETH, USDS, SKY and expected-token balances are fetched on demand (Refresh, max once
      per hour).
      {rowCount > 0 && <span className="mono text-[11px] ml-2">{rowCount} addresses</span>}
    </>
  );
}

export function OnchainAddressesReport({ query, mode }: { query: string; mode: ReportMode }) {
  const { rows, shown, filters, ...s } = useOnchainAddressesState(REPORT, query, mode);
  return (
    <ReportShell
      report={REPORT}
      maxWidth="max-w-7xl"
      description={<OnchainAddressesIntro rowCount={rows.length} />}
      controls={<OnchainAddressControls {...s.pills} />}
      query={query}
      filters={filters}
      searches={SEARCHES}
      count={
        <>
          <p className="text-xs text-tan-3">{shown.length} addresses</p>
          <OnchainBalanceRefresh {...s.balances} />
          <OnchainBalanceAge bal={s.balances.bal} error={s.balances.error} />
        </>
      }
      actions={<OnchainAddressesCsvButton report={REPORT} rows={rows} shown={shown} query={query} filters={filters} />}
      loading={s.loading}
      viewProps={{ row_count: rows.length }}
      noRows={rows.length > 0 && shown.length === 0}
      fullWidth={<OnchainAddressesTable rows={shown} rq={s.rq} />}
    />
  );
}
