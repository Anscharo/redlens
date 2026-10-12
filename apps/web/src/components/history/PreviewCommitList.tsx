import { commitsSettled, type PreviewCommitsState } from "@/lib/previewCommits";
import { commitsEndNote } from "../../lib/previewCommitCopy";
import { PreviewCommitRow } from "./PreviewCommitRow";
import { TimelineRow } from "./Timeline";

/** Indeterminate while the branch is fetched, then `n / walking` as commits arrive. */
function CommitProgress({ state }: { state: PreviewCommitsState }) {
  const n = state.commits.length;
  const known = state.phase === "walking" && state.walking > 0;
  const label = known
    ? `reading commits ${n} / ${state.walking}`
    : state.walking
      ? `fetching ${state.walking} commit${state.walking === 1 ? "" : "s"}`
      : "fetching commits";
  return (
    <p className="flex items-center gap-2 my-2">
      <progress aria-label="Commit history" value={known ? n : undefined} max={known ? state.walking : undefined} className="w-24" style={{ accentColor: "var(--accent)" }} />
      <span role="status">{label}</span>
    </p>
  );
}

interface Props {
  state: PreviewCommitsState;
  /** Whether the branch's overall diff touches this document. */
  changed: boolean;
  repo?: string;
}

/** The branch's commits that touched this document, newest first, as they
 *  stream in. Merges show as markers between them; a branch whose commits
 *  never touched it shows only the end note. */
export function PreviewCommitList({ state, changed, repo }: Props) {
  const touching = state.commits.some((c) => c.entries.length > 0);
  const shown = touching ? state.commits.filter((c) => c.entries.length > 0 || c.merge) : [];
  const note = commitsEndNote(state, changed);
  return (
    <section aria-label="Commits in this branch" aria-busy={!commitsSettled(state)}>
      {!commitsSettled(state) && <TimelineRow><CommitProgress state={state} /></TimelineRow>}
      {shown.map((c) => <PreviewCommitRow key={c.sha} commit={c} repo={repo} />)}
      {note && <TimelineRow><p className="my-2 leading-snug">{note}</p></TimelineRow>}
    </section>
  );
}
