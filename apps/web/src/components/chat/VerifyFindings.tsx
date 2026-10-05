import { Fragment, type ComponentProps } from "react";
import type { VerifyState } from "./useChatStream";
import { FINDING_ROWS } from "./findingRows";

// The expanded findings list behind VerifyBadge's chip — the "why" half; the
// chip is the "what". Refutation-only: a candidate the confirm judge did not
// agree with never reaches this component (the confirm gate is hard). Which
// findings exist, and in what order, is findingRows.tsx's table.

// Whether a verdict has anything to list. Derived from the same table the
// list renders, so the chip and the list can never disagree.
export function hasFindings(verify: VerifyState): boolean {
  return FINDING_ROWS.some((row) => row.has(verify));
}

export type VerifyFindingsProps = ComponentProps<"ul"> & {
  /** The verdict whose findings to list. Renders nothing for a clean one. */
  verify: VerifyState;
  /** Opens an atlas document behind a citation link in a finding. */
  onAtlas: (uuid: string) => void;
};

export function VerifyFindings({ verify, onAtlas, className, ...props }: VerifyFindingsProps) {
  // A clean verdict has nothing to list — an empty bordered box under
  // "Verifying content" reads as a rendering mistake, not as "all clear".
  if (!hasFindings(verify)) return null;
  return (
    <ul className={["rlc-verify-claims", className].filter(Boolean).join(" ")} {...props}>
      {FINDING_ROWS.map((row, i) => (
        <Fragment key={i}>{row.render(verify, onAtlas)}</Fragment>
      ))}
    </ul>
  );
}
