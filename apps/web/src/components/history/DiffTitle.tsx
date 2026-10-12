import type { PreviewMeta } from "../../lib/previewMetaCopy";
import { LINE1_H } from "./Timeline";

interface Props {
  meta: PreviewMeta | null;
  /** Whether a line 1 (date / PR) sits above. Without one this is the row's
   *  first line and carries LINE1_H, so the timeline dot centers on it. */
  belowLine1: boolean;
}

/** The preview entry's title line: the PR's title, or, with no PR to point
 *  at, the branch the change lives on. Nothing when meta names neither. */
export function DiffTitle({ meta, belowLine1 }: Props) {
  const title = meta?.prNumber ? meta.prTitle : meta?.ref && <>Branch: {meta.repo?.split("/")[0]}/{meta.ref}</>;
  if (!title) return null;
  return (
    <p
      className={`italic text-[12px] ${belowLine1 ? "leading-snug mt-1" : ""}`}
      style={{ color: "var(--tan)", ...(belowLine1 ? null : { lineHeight: `${LINE1_H}px` }) }}
    >
      {title}
    </p>
  );
}
