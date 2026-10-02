import type { RewardsSummary } from "./useRewardsState";

/** The Rewards report's description line, with the DR/IB tally once loaded. */
export function RewardsDescription({ summary }: { summary: RewardsSummary | null }) {
  const invocations = summary ? summary.drInvocations + summary.ibInvocations : 0;
  return (
    <>
      Every Distribution Reward and Integration Boost instance each Prime Agent has invoked, with reward
      codes, partner names, and on-chain reward addresses — sourced from the Atlas.
      {summary && (
        <span className="mono text-[11px] ml-2">
          {summary.dr} DR · {summary.ib} IB ·{" "}
          {invocations > 0 && (
            <>
              {invocations} invocation{invocations === 1 ? "" : "s"} ·{" "}
            </>
          )}
          {summary.codes} codes · {summary.addrs} addresses
        </span>
      )}
    </>
  );
}
