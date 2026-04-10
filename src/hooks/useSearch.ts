import { useEffect, useRef, useState, useCallback } from "react";
import type { SearchHit, WorkerOutMessage } from "../types";

export type SearchState =
  | { status: "idle" }
  | { status: "loading" } // worker not ready yet
  | { status: "searching" }
  | { status: "done"; hits: SearchHit[]; durationMs: number; query: string }
  | { status: "error"; message: string };

export function useSearch() {
  const workerRef = useRef<Worker | null>(null);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<SearchState>({ status: "loading" });
  const pendingId = useRef(0);
  const lastQuery = useRef("");

  useEffect(() => {
    const worker = new Worker(
      new URL("../workers/search.worker.ts", import.meta.url),
      { type: "module" }
    );

    worker.addEventListener("message", (e: MessageEvent<WorkerOutMessage>) => {
      const msg = e.data;
      if (msg.type === "ready") {
        setReady(true);
        setState({ status: "idle" });
      } else if (msg.type === "results") {
        if (msg.id === pendingId.current) {
          setState({
            status: "done",
            hits: msg.hits,
            durationMs: msg.durationMs,
            query: lastQuery.current,
          });
        }
      } else if (msg.type === "error") {
        setState({ status: "error", message: msg.message });
      }
    });

    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  const search = useCallback((q: string) => {
    const worker = workerRef.current;
    if (!worker) return;

    const trimmed = q.trim();
    if (!trimmed) {
      setState({ status: "idle" });
      return;
    }

    lastQuery.current = trimmed;
    const id = ++pendingId.current;
    setState({ status: "searching" });
    worker.postMessage({ type: "query", id, q: trimmed });
  }, []);

  return { state, search, ready };
}
