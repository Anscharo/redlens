import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import "./index.css";
import App from "./App.tsx";
import { ErrorBoundary, PanelError } from "./components/ErrorBoundary";
import { isStaleChunkError } from "./lib/staleChunk";
import { AuthProvider } from "./components/chat/auth";
import { SelectionProvider } from "./lib/selection";
import { ChatOpenProvider } from "./lib/chatOpen";
import { DataSourceContext, DEFAULT_SOURCE } from "./lib/dataSource";
import { PreviewGate } from "./components/preview/PreviewGate";
import { PreviewHome } from "./components/preview/PreviewHome";
import { restoreAuthReturn } from "./lib/authReturn";
import { installConsoleCapture } from "./lib/consoleCapture";
import { installInteractionCapture } from "./lib/lastInteraction";

// Installed here, at module scope, rather than in App.tsx or a React effect:
// StrictMode double-invokes effects (which would double-patch console
// methods), and PreviewHome/PreviewGate bypass App entirely — this line runs
// for every surface. Module scope also means it's live before first render,
// so boot-time errors are captured for the feedback tool from the start.
installConsoleCapture();
installInteractionCapture();

const baseNoSlash = import.meta.env.BASE_URL.replace(/\/$/, "");

// `/preview` (bare) is the index page; `/preview/:id/*` mounts the SAME App
// under a preview router base + data source (after the gate builds the
// bundle); anything else is the live atlas.
function Root() {
  const { pathname } = window.location;
  if (pathname === `${baseNoSlash}/preview` || pathname === `${baseNoSlash}/preview/`) {
    // AuthProvider so the index can show the same account/sign-in control the
    // live app has (needed to view private previews). apiUrl is absolute
    // (`/api/…`), so no DataSource/Router context is required here.
    return (
      <AuthProvider>
        <PreviewHome />
      </AuthProvider>
    );
  }
  const m = pathname.match(new RegExp(`^${baseNoSlash}/preview/([^/]+)`));
  if (m) {
    return <PreviewGate id={decodeURIComponent(m[1])} routerBase={`${baseNoSlash}/preview/${m[1]}`} />;
  }
  // Live app only (preview surfaces returned above): if we just came back from an
  // OAuth round-trip, rewrite the URL to where sign-in started before the Router
  // reads it — no flash of the app root. Consume-once, so re-renders don't repeat.
  restoreAuthReturn();
  return (
    <Router base={baseNoSlash}>
      <DataSourceContext.Provider value={DEFAULT_SOURCE}>
        <AuthProvider>
          <SelectionProvider>
            <ChatOpenProvider>
              <App />
            </ChatOpenProvider>
          </SelectionProvider>
        </AuthProvider>
      </DataSourceContext.Provider>
    </Router>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary
      fallback={(error) =>
        isStaleChunkError(error) ? (
          <div className="flex items-center justify-center h-dvh">
            <PanelError error={error} />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-dvh gap-4 text-center px-4">
            <p className="text-sm mono" style={{ color: "var(--error-text)" }}>Something went wrong</p>
            <p className="text-xs mono text-tan-3 max-w-md">{error.message}</p>
            <a href={import.meta.env.BASE_URL} className="text-xs mono text-accent hover:underline">← home</a>
          </div>
        )
      }
    >
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);
