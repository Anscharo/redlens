import { urlEnum, useUrlState } from "../../hooks/useUrlState";
import { usePreviewCommits } from "../../hooks/usePreviewCommits";
import { useDataSource } from "../../lib/dataSource";
import { usePreviewDiff } from "../../lib/previewDiff";
import { usePreviewMeta } from "../../lib/previewMeta";
import { PreviewCommitList } from "./PreviewCommitList";
import { TimelineRow } from "./Timeline";

/** `?history=by-commit` turns the list on; no parameter is off. */
const HISTORY = urlEnum<"" | "by-commit">("", ["by-commit"]);

interface Props {
  nodeId: string;
  /** Whether the branch's overall diff touches this document. */
  changed: boolean;
}

/** Under a preview's overall diff: a switch that lists the branch's commits
 *  that touched this document, against the same diff base as the redline. It
 *  shows for unchanged documents too, since a branch can change one and then
 *  change it back. */
export function PreviewCommits({ nodeId, changed }: Props) {
  const [mode, setMode] = useUrlState("history", HISTORY);
  const on = mode === "by-commit";
  const { activeBase } = usePreviewDiff();
  const baseKey = activeBase?.key === "sky" || activeBase?.key === "repo" ? activeBase.key : null;
  const state = usePreviewCommits(nodeId, baseKey, on);
  const repo = usePreviewMeta(useDataSource().base)?.repo;
  return (
    <>
      <TimelineRow>
        <button
          type="button"
          aria-pressed={on}
          onClick={() => setMode(on ? "" : "by-commit")}
          className="mono text-[11px] my-2 px-2 py-0.5 rounded hover:underline focus-visible:underline"
          style={{ border: "1px solid var(--border)", color: on ? "var(--tan)" : "var(--tan-3)", background: on ? "var(--hover)" : "transparent" }}
        >
          By commit
        </button>
      </TimelineRow>
      {state && <PreviewCommitList state={state} changed={changed} repo={repo} />}
    </>
  );
}
