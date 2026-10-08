import type { AddressInfo } from "@/types";
import type { ChainValue } from "../../lib/chainstate";
import { AddressCard } from "../AddressCard";
import { ErrorBoundary, InlineError } from "../ErrorBoundary";
import type { DocVote } from "@/lib/votes/docVotes";
import { ExecutiveVoteList } from "./DocVotes";
import { SECTION_HEAD } from "./panelSections";

// The right panel's onchain section: one card per address the document names,
// then the Executive Votes behind it (a cast spell is an on-chain execution).
// Each block shows only when it has rows.
export function PanelOnchain({
  targetAddresses,
  chainValues,
  byNameOnly,
  executives,
}: {
  targetAddresses: Record<string, AddressInfo>;
  chainValues: Record<string, Record<string, ChainValue>>;
  /** Addresses this section named only by chainlog key, not a 0x literal. */
  byNameOnly?: Set<string>;
  executives: DocVote[];
}) {
  const entries = Object.entries(targetAddresses);
  return (
    <div className="space-y-8">
      {entries.length > 0 && (
        <div>
          <p className={`${SECTION_HEAD} mb-4`}>addresses · {entries.length}</p>
          {entries.map(([address, info]) => (
            <ErrorBoundary key={address} fallback={(error) => <InlineError error={error} />}>
              <AddressCard address={address} info={info} chainValues={chainValues[address]} byName={byNameOnly?.has(address)} />
            </ErrorBoundary>
          ))}
        </div>
      )}
      {executives.length > 0 && (
        <ErrorBoundary fallback={(error) => <InlineError error={error} />}>
          <ExecutiveVoteList votes={executives} />
        </ErrorBoundary>
      )}
    </div>
  );
}
