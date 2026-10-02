// Chain/Type pill groups and the CSV export for the On-chain Addresses report.
import {
  onchainAddressRowsToCSV,
  onchainCsvRowCount,
  type AddressType,
  type OnchainAddressRow,
} from "@/lib/onchainAddressesIndex";
import type { ReportId } from "@/types";
import { CategoryPills } from "./CategoryPills";
import { DownloadCsvButton } from "./DownloadCsvButton";

export function OnchainAddressControls({
  chains,
  chainFilter,
  onChain,
  types,
  typeFilter,
  onType,
}: {
  chains: string[];
  chainFilter: string | null;
  onChain: (next: string) => void;
  types: AddressType[];
  typeFilter: string | null;
  onType: (next: string) => void;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3">
      <CategoryPills label="Chain" categories={chains} active={chainFilter} onToggle={onChain} showSingle />
      <CategoryPills label="Type" categories={types} active={typeFilter} onToggle={onType} showSingle />
    </div>
  );
}

export function OnchainAddressesCsvButton({
  report,
  rows,
  shown,
  query,
  filters,
}: {
  report: ReportId;
  rows: readonly OnchainAddressRow[];
  shown: readonly OnchainAddressRow[];
  query: string;
  filters: (string | null)[];
}) {
  return (
    <DownloadCsvButton
      report={report}
      filename="onchain-addresses.csv"
      rowCount={onchainCsvRowCount(shown)}
      build={() => onchainAddressRowsToCSV(shown)}
      fullRowCount={onchainCsvRowCount(rows)}
      buildFull={() => onchainAddressRowsToCSV(rows)}
      query={query}
      filters={filters}
    />
  );
}
