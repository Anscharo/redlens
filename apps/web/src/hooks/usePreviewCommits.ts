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

/** A frame that does not parse ends the stream as failed, like a dropped one. */
function parse(data: string): PreviewCommitEvent {
  try {
    return JSON.parse(data) as PreviewCommitEvent;
  } catch {
    return { type: "error", reason: "failed" };
  }
}

/** Follow one commit stream into `dispatch`; returns its close. A dropped
 *  stream is not reopened: the server would replay it from the start. */
function follow(url: string, dispatch: (a: Action) => void): () => void {
  const es = new EventSource(url);
  let ended = false;
  es.addEventListener("commits", (e) => {
    const ev = parse((e as MessageEvent).data);
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
 *  while `on`, against the diff base the redline uses. A null base key (no
 *  merge base) is unavailable without a request; an undefined one is still
 *  resolving, so the stream waits for it. */
export function usePreviewCommits(nodeId: string, baseKey: PreviewBaseKey | null | undefined, on: boolean): PreviewCommitsState | null {
  const { base, preview } = useDataSource();
  const sha = preview?.sha;
  const [state, dispatch] = useReducer(reducer, INITIAL_COMMITS);
  useEffect(() => {
    dispatch({ type: "reset" });
    if (!on || !sha || baseKey === undefined) return;
    if (!baseKey) return dispatch({ type: "error", reason: "unavailable" });
    return follow(`${base}commits?base=${baseKey}&uuid=${encodeURIComponent(nodeId)}`, dispatch);
  }, [base, sha, nodeId, baseKey, on]);
  return on && sha ? state : null;
}
