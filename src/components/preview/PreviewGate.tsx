import { useEffect, useState } from "react";
import { Router } from "wouter";
import App from "../../App";
import { AuthProvider } from "../chat/auth";
import { DataSourceContext } from "../../lib/dataSource";
import { PreviewDiffProvider } from "../../lib/previewDiff";
import { PreviewViewProvider } from "../../lib/previewView";
import { PreviewInterstitial } from "./PreviewInterstitial";
import { recordLocalPreview, previewLabel } from "../../lib/previewLocal";
import { BuildErrorDetail } from "./BuildErrorDetail";
import { stashAuthReturn } from "../../lib/authReturn";
import { apiUrl } from "../chat/api";

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
  "not-a-fork":
    "This repo can't be compared against the atlas (it's not in its fork network). Fork sky-ecosystem/next-gen-atlas and push your branch there.",
  "not-derived":
    "This branch shares no history with the atlas, so there's nothing to redline it against. Branch from the atlas's history and push again.",
  "fork-not-trusted": "This fork's owner has no contribution history with the Sky ecosystem — open a draft PR to preview it.",
  "source-gone": "The source is gone (the fork may have been deleted).",
  "cap-exceeded": "This atlas is too large to preview.",
  "build-failed": "This proposal could not be built into a preview.",
  "rate-limited": "Too many preview requests — try again shortly.",
  "quota-exceeded": "The daily preview limit is reached — try again tomorrow.",
  unavailable: "The access check is temporarily unavailable — try again shortly.",
  // Neutral fallbacks — dedicated screens below handle these codes, but a
  // harmless entry here keeps the generic fallback sane if that ever changes.
  "auth-required": "Sign in with GitHub to view this private preview.",
  forbidden: "You don't have access to this repository.",
  "app-not-installed": "The RedLens app isn't installed on this repository.",
};

export function usePreviewBuild(id: string) {
  const [state, setState] = useState<{ phase: Phase; sha: string | null; code: string | null; message: string | null }>({
    phase: "resolving",
    sha: null,
    code: null,
    message: null,
  });
  useEffect(() => {
    setState({ phase: "resolving", sha: null, code: null, message: null });
    const es = new EventSource(`${import.meta.env.BASE_URL}api/preview/${encodeURIComponent(id)}/events`);
    es.addEventListener("preview", (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as { phase: Phase; sha?: string; code?: string; message?: string };
      setState((s) => ({ phase: ev.phase, sha: ev.sha ?? s.sha, code: ev.code ?? s.code, message: ev.message ?? s.message }));
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
  const { phase, sha, code, message } = usePreviewBuild(id);

  // Remember successful opens so the /preview index can list "your" previews
  // (survives DB wipes; no account needed).
  useEffect(() => {
    if (phase === "ready" && sha) recordLocalPreview(id, sha);
  }, [phase, sha, id]);

  if (phase === "failed") {
    if (code === "auth-required") {
      return (
        <Centered>
          <p className="text-red">This is a private preview — sign in with GitHub to view it.</p>
          <button
            type="button"
            className="px-4 py-2 rounded mono text-sm"
            style={{ background: "var(--hover)", border: "1px solid var(--accent)", color: "var(--tan)" }}
            onClick={() => {
              stashAuthReturn(window.location.pathname + window.location.search);
              window.location.href = apiUrl("auth/github");
            }}
          >
            Sign in with GitHub
          </button>
          <a href={import.meta.env.BASE_URL} className="text-sm" style={{ color: "var(--accent)" }}>
            ← back to the live atlas
          </a>
        </Centered>
      );
    }

    if (code === "forbidden") {
      return (
        <Centered>
          <p className="text-red">You don't have access to this repository.</p>
          <a href={import.meta.env.BASE_URL} className="text-sm" style={{ color: "var(--accent)" }}>
            ← back to the live atlas
          </a>
        </Centered>
      );
    }

    if (code === "app-not-installed") {
      const installUrl = message && /^https?:\/\//.test(message) ? message : null;
      return (
        <Centered>
          <p className="text-red">
            The RedLens app isn't installed on this repository. Ask the repo owner/admin to install it, then reopen
            this link.
          </p>
          {installUrl && (
            <a href={installUrl} target="_blank" rel="noreferrer" className="text-sm" style={{ color: "var(--accent)" }}>
              Install the app ↗
            </a>
          )}
          <a href={import.meta.env.BASE_URL} className="text-sm" style={{ color: "var(--accent)" }}>
            ← back to the live atlas
          </a>
        </Centered>
      );
    }

    return (
      <Centered>
        <p className="text-red">{(code && ERROR_TEXT[code]) ?? "Preview failed."}</p>
        {message && <BuildErrorDetail message={message} />}
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
          Preparing preview Sky Atlas for {previewLabel(id)}…
        </div>
        <div className="text-sm" style={{ color: "var(--tan-3)" }}>
          {PHASE_TEXT[phase as keyof typeof PHASE_TEXT]}
        </div>
      </Centered>
    );
  }

  const base = `${import.meta.env.BASE_URL}api/preview/${sha}/`;
  return (
    <PreviewInterstitial sha={sha} base={base}>
      <Router base={routerBase}>
        <DataSourceContext.Provider value={{ base, preview: { id, sha } }}>
          <PreviewDiffProvider>
            <PreviewViewProvider>
              <AuthProvider>
                <App />
              </AuthProvider>
            </PreviewViewProvider>
          </PreviewDiffProvider>
        </DataSourceContext.Provider>
      </Router>
    </PreviewInterstitial>
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
