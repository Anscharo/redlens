import { entrySourceUrl, type PreviewMeta } from "../../lib/previewMetaCopy";
import { LINE1_H } from "./Timeline";

/** Whether the preview entry has a line 1: a head-commit date or a PR to name.
 *  Absent, the title line below takes over as the row's first line. */
export const hasLine1 = (meta: PreviewMeta | null) => !!meta?.headCommitAt || !!meta?.prNumber;

/** Line 1 of the preview entry, like a live entry's: the head commit's date
 *  (the real "when" behind the change), then the PR it came from. LINE1_H
 *  centers the timeline dot on it. */
export function PreviewEntryLine1({ meta }: { meta: PreviewMeta | null }) {
  if (!meta || !hasLine1(meta)) return null;
  const date = meta.headCommitAt?.slice(0, 10);
  return (
    <div className="flex items-baseline gap-2 flex-wrap mono text-[13px]" style={{ lineHeight: `${LINE1_H}px` }}>
      {date ? <time dateTime={date}>{date}</time> : null}
      {meta.prNumber ? (
        <a href={entrySourceUrl(meta)} target="_blank" rel="noreferrer" className="hover:underline focus-visible:underline" style={{ color: "var(--accent)" }}>
          PR {meta.prNumber}
        </a>
      ) : null}
    </div>
  );
}
