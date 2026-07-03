// "Other changes in this commit" strip (plan §10.4 workflow). The curation queue is
// commit-major — you finish every change in one commit before the one before it — so
// this shows the sibling cases of the current commit in document order, each flagged
// decided / undecided. Click a chip (or press ↑/↓) to move within the commit; the
// header names the commit. Pure presentational: all state arrives as props.
import type { CurationCase, CurationNode, Pick } from "../../lib/historyCuration";

const short = (sha: string) => sha.slice(0, 7);

type Commit = { sha: string; date: string | null; pr: number | null; isSeed: boolean; prTitle?: string; changeSummary?: string };

function CommitLabel({ commit }: { commit: Commit }) {
  return (
    <span className="text-[12px] mono" style={{ color: "var(--tan-3)" }}>
      {commit.isSeed ? "#117 migration seam" : `commit ${short(commit.sha)}`}
      {commit.pr ? ` · PR #${commit.pr}` : ""}
      {commit.date ? ` · ${commit.date.slice(0, 10)}` : ""}
    </span>
  );
}

// The editorial description of this commit's change (PR title + linked forum edit-list) — names what
// was Updated (a continuation) vs Added (a birth), the context for every decision in the commit.
function ChangeNote({ commit }: { commit: Commit }) {
  if (!commit.prTitle && !commit.changeSummary) return null;
  return (
    <details className="mt-1 text-[12px]" style={{ color: "var(--tan-2)" }}>
      <summary className="cursor-pointer" style={{ color: "var(--accent)" }}>
        change: {commit.prTitle || `PR #${commit.pr}`}
      </summary>
      {commit.changeSummary && (
        <p className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap" style={{ color: "var(--tan-3)" }}>{commit.changeSummary}</p>
      )}
    </details>
  );
}

export function CurationCommitStrip({
  commit, siblings, currentKey, picks, nodes, onJump,
}: {
  commit: Commit;
  siblings: CurationCase[];
  currentKey: string;
  picks: Record<string, Pick>;
  nodes: Record<string, CurationNode>;
  onJump: (key: string) => void;
}) {
  const decided = siblings.filter((s) => picks[s.key] !== undefined).length;
  return (
    <section className="mb-2 rounded p-2" style={{ border: "1px solid var(--border)", background: "var(--surface)" }}>
      <div className="flex items-baseline justify-between gap-2 mb-1.5 flex-wrap">
        <CommitLabel commit={commit} />
        <span className="text-[12px]" style={{ color: "var(--tan-3)" }}>
          {siblings.length} change{siblings.length === 1 ? "" : "s"} in this commit · {decided} decided · <span className="mono">↑/↓</span> to move
        </span>
      </div>
      <ChangeNote commit={commit} />
      <div className="flex gap-1 overflow-x-auto pb-1">
        {siblings.map((s, i) => {
          const isCurrent = s.key === currentKey;
          const done = picks[s.key] !== undefined;
          const title = nodes[s.subjectKey]?.title || "(untitled)";
          return (
            <button key={s.key} onClick={() => onJump(s.key)} title={title}
              className="shrink-0 max-w-[14rem] flex items-center gap-1.5 rounded px-2 py-1 text-[12px]"
              style={{
                background: isCurrent ? "color-mix(in srgb, var(--accent) 18%, transparent)" : "var(--bg)",
                border: `1px solid ${isCurrent ? "var(--accent)" : "var(--border)"}`,
                color: "var(--tan-2)",
              }}>
              <span className="shrink-0 mono" style={{ color: done ? "var(--diff-added-fg)" : "var(--tan-3)" }}>
                {done ? "✓" : i + 1}
              </span>
              <span className="truncate">{title}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
