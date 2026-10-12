import { CHANGE_COLOR } from "@/lib/history";
import type { PreviewCommit, PreviewCommitRow as Row } from "@/lib/previewCommits";
import { commitRowLabel } from "../../lib/previewCommitCopy";
import { DiffView } from "./DiffView";
import { LINE1_H } from "./Timeline";
import { TimelineBranch } from "./TimelineBranch";

const rowColor = (r: Row) => CHANGE_COLOR[r.changeType === "renumbered" ? "moved" : r.changeType] ?? "var(--tan-3)";

/** What one commit did to this document: its change line, then its diff. */
function CommitEntry({ row }: { row: Row }) {
  return (
    <>
      <p className="mono text-[12px] mt-1 break-all" style={{ color: rowColor(row) }}>
        {commitRowLabel(row)}
      </p>
      {row.diff && <DiffView lines={row.diff} />}
    </>
  );
}

interface Props {
  commit: PreviewCommit;
  /** owner/name the commit lives in, for its GitHub link. */
  repo?: string;
}

/** One branch commit, branched off the preview rail and laid out like a live
 *  entry: line 1 is the date, the short sha linked to GitHub and the author;
 *  line 2 the commit's subject; then each change it made to this document. A
 *  merge that left the document alone is a dotless marker. */
export function PreviewCommitRow({ commit, repo }: Props) {
  const sha = commit.sha.slice(0, 7);
  const touched = commit.entries.length > 0;
  return (
    <article data-merge={commit.merge || undefined}>
      <TimelineBranch dot={touched ? rowColor(commit.entries[0]) : undefined}>
        <h5 className={`flex items-baseline gap-2 flex-wrap mono ${touched ? "text-[13px]" : "text-[11px] my-1"}`} style={{ lineHeight: `${LINE1_H}px`, color: "var(--tan-3)" }}>
          {touched && <time dateTime={commit.date}>{commit.date.slice(0, 10)}</time>}
          {commit.merge && <span>merge</span>}
          {repo ? (
            <a href={`https://github.com/${repo}/commit/${commit.sha}`} target="_blank" rel="noreferrer" className="hover:underline focus-visible:underline" style={{ color: "var(--accent)" }}>
              {sha}
            </a>
          ) : (
            <span>{sha}</span>
          )}
          {commit.author && <span>{commit.author}</span>}
          {!touched && <span className="italic truncate">{commit.message}</span>}
        </h5>
        {touched && (
          <p className="italic text-[12px] leading-snug mt-1" style={{ color: "var(--tan)" }}>
            {commit.message}
          </p>
        )}
        {commit.entries.map((row, i) => <CommitEntry key={i} row={row} />)}
      </TimelineBranch>
    </article>
  );
}
