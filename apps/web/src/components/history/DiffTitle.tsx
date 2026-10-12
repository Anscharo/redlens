import type { PreviewMeta } from "../../lib/previewMetaCopy";
import { hasLine1 } from "./PreviewEntryLine1";
import { LINE1_H } from "./Timeline";

/** The preview entry's title line: the PR's title, or, with no PR to point
 *  at, the branch the change lives on. Nothing when meta names neither. With
 *  no line 1 above it, it is the row's first line and carries LINE1_H, so the
 *  timeline dot centers on it. */
export function DiffTitle({ meta }: { meta: PreviewMeta | null }) {
  const belowLine1 = hasLine1(meta);
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
