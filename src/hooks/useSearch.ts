import { useEffect, useRef, useState, useCallback } from "react";
import type { SearchHit, WorkerOutMessage } from "../types";
import { loadAtlas } from "../lib/docs";
import { loadAddresses } from "../lib/addresses";

export type SearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "searching" }
  | { status: "done"; hits: SearchHit[]; durationMs: number; query: string }
  | { status: "error"; message: string };

export function useSearch() {
  const workerRef = useRef<Worker | null>(null);
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<SearchState>({ status: "loading" });
  const pendingId = useRef(0);
  const lastQuery = useRef("");
  const pendingBeforeReady = useRef<{ q: string; id: number } | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL("../workers/search.worker.ts", import.meta.url), {
      type: "module",
    });

    worker.addEventListener("error", (e: ErrorEvent) => {
      console.error("Search worker error:", e.message, e);
      setState({ status: "error", message: e.message ?? "Worker failed to load" });
    });

    worker.addEventListener("message", (e: MessageEvent<WorkerOutMessage>) => {
      const msg = e.data;
      if (msg.type === "ready") {
        readyRef.current = true;
        setReady(true);
        const pending = pendingBeforeReady.current;
        if (pending) {
          pendingBeforeReady.current = null;
          lastQuery.current = pending.q;
          // State is already "searching" — skip idle flash, go straight to results
          worker.postMessage({ type: "query", id: pending.id, q: pending.q });
        } else {
          setState({ status: "idle" });
        }
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

    // Forward already-loaded docs + addresses so the search worker doesn't
    // fetch them again independently (avoids duplicate 5.6 MB downloads).
    Promise.all([loadAtlas(), loadAddresses()]).then(([bundle, addresses]) => {
      worker.postMessage({ type: "preload", docs: bundle.docs, addresses: addresses ?? {} });
    }).catch(() => {});

    return () => worker.terminate();
  }, []);

  const search = useCallback((q: string) => {
    const worker = workerRef.current;
    if (!worker) return;

    const trimmed = q.trim();
    if (!trimmed) {
      pendingBeforeReady.current = null;
      setState({ status: "idle" });
      return;
    }

    lastQuery.current = trimmed;
    const id = ++pendingId.current;
    setState({ status: "searching" });

    if (!readyRef.current) {
      pendingBeforeReady.current = { q: trimmed, id };
      return;
    }

    worker.postMessage({ type: "query", id, q: trimmed });
  }, []);

  return { state, search, ready };
}
