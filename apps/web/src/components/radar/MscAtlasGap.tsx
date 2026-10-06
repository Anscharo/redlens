import type { AtlasAmountDue } from "@/lib/settlementAtlasCheck";
import { SETTLEMENT_CITATIONS } from "@/lib/settlementCitations";
import { atlasHref } from "@/lib/routes";
import { formatUsd } from "../../lib/settlements";
import { AtlasLink } from "../AtlasLink";

const WHY =
  "The Atlas floors each venue's profit at zero (Instance Profit, A.2.4.1.2.2.1.1.2.2.1), so a venue earning less than its cost of funds sends Sky its revenue, not its full cost of funds as Soter charges; Spark's USDT and pyUSD instances are exceptions and carry full profit and loss (A.2.4.1.2.2.1.1.4). " +
  "The formula then deducts the Distortion and Low Yield Actively Stabilizing Collateral penalties from profit (A.2.4.1.2.2.1.1.2.3), which raise the amount due. The workbooks carry neither, so the difference shown is the most it can be.";

/** Soter's amount due to Sky beside the Atlas's Stage 1 formula over the
 *  same venue rows, before penalties: one muted line, only when they
 *  differ by a dollar or more. `plain` drops the links, for a line inside
 *  a link of its own. */
export function MscAtlasGap({ due, className = "", plain }: { due?: AtlasAmountDue | null; className?: string; plain?: boolean }) {
  if (!due || Math.abs(due.gap) < 1) return null;
  const { amountDue, adjustedProfit } = SETTLEMENT_CITATIONS;
  if (plain) {
    return (
      <p className={`mono text-[10px] m-0 ${className}`} style={{ color: "var(--tan-3)" }} title={WHY}>
        Atlas Stage 1 formula: up to {formatUsd(due.gap, true)} less to Sky, before penalties
      </p>
    );
  }
  return (
    <p className={`mono text-[10px] m-0 ${className}`} style={{ color: "var(--tan-3)" }} title={WHY}>
      The Atlas&rsquo;s <AtlasLink to={atlasHref(amountDue.uuid)} className="msc-arc-caption-link">Stage 1 formula</AtlasLink> gives {formatUsd(due.atlas, true)} due to Sky before{" "}
      <AtlasLink to={atlasHref(adjustedProfit.uuid)} className="msc-arc-caption-link">penalties</AtlasLink>: up to {formatUsd(due.gap, true)} less than Soter&rsquo;s figure.
    </p>
  );
}
