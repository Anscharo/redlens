import { LINE1_H } from "./Timeline";

interface Props {
  /** The head commit's date, YYYY-MM-DD. */
  date?: string;
  prNumber?: number;
  href: string | null;
}

/** Line 1 of the preview entry, like a live entry's: the head commit's date,
 *  then the PR it came from. LINE1_H centers the timeline dot on it. */
export function PreviewEntryLine1({ date, prNumber, href }: Props) {
  return (
    <div className="flex items-baseline gap-2 flex-wrap mono text-[13px]" style={{ lineHeight: `${LINE1_H}px` }}>
      {date ? <time dateTime={date}>{date}</time> : null}
      {prNumber !== undefined && (
        <a href={href ?? undefined} target="_blank" rel="noreferrer" className="hover:underline focus-visible:underline" style={{ color: "var(--accent)" }}>
          PR {prNumber}
        </a>
      )}
    </div>
  );
}
