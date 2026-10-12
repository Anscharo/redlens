import { useEffect, useReducer } from "react";
import {
  INITIAL_COMMITS,
  reduceCommits,
  type PreviewCommitEvent,
  type PreviewCommitsState,
} from "@/lib/previewCommits";
import { useDataSource } from "../lib/dataSource";
import type { PreviewBaseKey } from "../lib/previewMetaTypes";

type Action = PreviewCommitEvent | { type: "reset" };

const reducer = (s: PreviewCommitsState, a: Action): PreviewCommitsState =>
  a.type === "reset" ? INITIAL_COMMITS : reduceCommits(s, a);

const terminal = (ev: PreviewCommitEvent) => ev.type === "done" || ev.type === "error";

/** Follow one commit stream into `dispatch`; returns its close. A dropped
 *  stream is not reopened: the server would replay it from the start. */
function follow(url: string, dispatch: (a: Action) => void): () => void {
  const es = new EventSource(url);
  let ended = false;
  es.addEventListener("commits", (e) => {
    const ev = JSON.parse((e as MessageEvent).data) as PreviewCommitEvent;
    ended ||= terminal(ev);
    dispatch(ev);
    if (ended) es.close();
  });
  es.onerror = () => {
    es.close();
    if (!ended) dispatch({ type: "error", reason: "failed" });
  };
  return () => es.close();
}

/** One document's commit-by-commit history on this preview's branch, streamed
 *  while `on`, against the diff base the redline uses. Without a base key (a
 *  live-main degrade) there is no range to walk, so nothing is requested. */
export function usePreviewCommits(nodeId: string, baseKey: PreviewBaseKey | null, on: boolean): PreviewCommitsState | null {
  const { base, preview } = useDataSource();
  const sha = preview?.sha;
  const [state, dispatch] = useReducer(reducer, INITIAL_COMMITS);
  useEffect(() => {
    dispatch({ type: "reset" });
    if (!on || !sha) return;
    if (!baseKey) return dispatch({ type: "error", reason: "unavailable" });
    return follow(`${base}commits?base=${baseKey}&uuid=${encodeURIComponent(nodeId)}`, dispatch);
  }, [base, sha, nodeId, baseKey, on]);
  return on && sha ? state : null;
}
