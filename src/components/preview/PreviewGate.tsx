import { useEffect, useState } from "react";
import { Router } from "wouter";
import App from "../../App";
import { AuthProvider } from "../chat/auth";
import { DataSourceContext } from "../../lib/dataSource";
import { PreviewDiffProvider } from "../../lib/previewDiff";

// Preview is NOT a separate view: the gate builds the bundle (SSE), then mounts
// the normal <App/> under a /preview/:id router base with the preview data
// source in context. Every route (reader, radar, …) renders unchanged, just
// reading the preview bundle. The banner is rendered inside the shell (App).

type Phase = "resolving" | "fetching" | "building" | "ready" | "failed";

const PHASE_TEXT: Record<Exclude<Phase, "ready" | "failed">, string> = {
  resolving: "Resolving…",
  fetching: "Fetching the proposed atlas…",
  building: "Building preview…",
};

const ERROR_TEXT: Record<string, string> = {
  "gate-rejected": "Open a draft PR against next-gen-atlas to preview this branch.",
  "not-found": "No such PR, branch, or pinned commit.",
  "source-gone": "The source is gone (the fork may have been deleted).",
  "cap-exceeded": "This atlas is too large to preview.",
  "build-failed": "This proposal could not be built into a preview.",
  "rate-limited": "Too many preview requests — try again shortly.",
  "quota-exceeded": "The daily preview limit is reached — try again tomorrow.",
};

export function usePreviewBuild(id: string) {
  const [state, setState] = useState<{ phase: Phase; sha: string | null; code: string | null }>({
    phase: "resolving",
    sha: null,
    code: null,
  });
  useEffect(() => {
    setState({ phase: "resolving", sha: null, code: null });
    const es = new EventSource(`${import.meta.env.BASE_URL}api/preview/${encodeURIComponent(id)}/events`);
    es.addEventListener("preview", (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as { phase: Phase; sha?: string; code?: string };
      setState((s) => ({ phase: ev.phase, sha: ev.sha ?? s.sha, code: ev.code ?? s.code }));
      if (ev.phase === "ready" || ev.phase === "failed") es.close();
    });
    es.onerror = () => {
      es.close();
      setState((s) => (s.phase === "ready" ? s : { ...s, phase: "failed" }));
    };
    return () => es.close();
  }, [id]);
  return state;
}

export function PreviewGate({ id, routerBase }: { id: string; routerBase: string }) {
  const { phase, sha, code } = usePreviewBuild(id);

  if (phase === "failed") {
    return (
      <Centered>
        <p className="text-red">{(code && ERROR_TEXT[code]) ?? "Preview failed."}</p>
        <a href={import.meta.env.BASE_URL} className="text-sm" style={{ color: "var(--accent)" }}>
          ← back to the live atlas
        </a>
      </Centered>
    );
  }

  if (phase !== "ready" || !sha) {
    return (
      <Centered>
        <div className="text-lg" style={{ color: "var(--tan)" }}>
          Preparing preview Sky Atlas…
        </div>
        <div className="text-sm" style={{ color: "var(--tan-3)" }}>
          {PHASE_TEXT[phase as keyof typeof PHASE_TEXT]}
        </div>
      </Centered>
    );
  }

  const base = `${import.meta.env.BASE_URL}api/preview/${sha}/`;
  return (
    <Router base={routerBase}>
      <DataSourceContext.Provider value={{ base, preview: { id, sha } }}>
        <PreviewDiffProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </PreviewDiffProvider>
      </DataSourceContext.Provider>
    </Router>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3"
      style={{ height: "100vh", textAlign: "center", background: "var(--bg)" }}
    >
      {children}
    </div>
  );
}
