import { urlEnum, useUrlState } from "../../hooks/useUrlState";
import { usePreviewCommits } from "../../hooks/usePreviewCommits";
import { useDataSource } from "../../lib/dataSource";
import { usePreviewDiff } from "../../lib/previewDiff";
import { usePreviewMeta } from "../../lib/previewMeta";
import type { ActiveBase, PreviewBaseKey, PreviewMeta } from "../../lib/previewMetaTypes";
import { PreviewCommitList } from "./PreviewCommitList";
import { TimelineRow } from "./Timeline";

/** `?history=by-commit` turns the list on; no parameter is off. */
const HISTORY = urlEnum<"" | "by-commit">("", ["by-commit"]);

/** The diff base to walk: the redline's own, null when it has none (a live-main
 *  degrade, or a bundle that names no bases), undefined while that is still
 *  unknown, so a shared link waits instead of reporting no merge base. */
function walkBase(meta: PreviewMeta | null | undefined, active: ActiveBase | null | undefined): PreviewBaseKey | null | undefined {
  if (active?.key === "sky" || active?.key === "repo") return active.key;
  if (active?.key === "live-main") return null;
  return meta === undefined || meta?.bases ? undefined : null;
}

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
  const meta = usePreviewMeta(useDataSource().base);
  const state = usePreviewCommits(nodeId, walkBase(meta, usePreviewDiff().activeBase), on);
  const repo = meta?.repo;
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
