import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import "./index.css";
import App from "./App.tsx";
import { ErrorBoundary, PanelError } from "./components/ErrorBoundary";
import { installStaleChunkReload, isStaleChunkError } from "./lib/staleChunk";
import { AuthProvider } from "./components/chat/auth";
import { DataSourceContext, DEFAULT_SOURCE } from "./lib/dataSource";
import { PreviewGate } from "./components/preview/PreviewGate";
import { PreviewHome } from "./components/preview/PreviewHome";

const baseNoSlash = import.meta.env.BASE_URL.replace(/\/$/, "");

// `/preview` (bare) is the index page; `/preview/:id/*` mounts the SAME App
// under a preview router base + data source (after the gate builds the
// bundle); anything else is the live atlas.
function Root() {
  const { pathname } = window.location;
  if (pathname === `${baseNoSlash}/preview` || pathname === `${baseNoSlash}/preview/`) {
    return <PreviewHome />;
  }
  const m = pathname.match(new RegExp(`^${baseNoSlash}/preview/([^/]+)`));
  if (m) {
    return <PreviewGate id={decodeURIComponent(m[1])} routerBase={`${baseNoSlash}/preview/${m[1]}`} />;
  }
  return (
    <Router base={baseNoSlash}>
      <DataSourceContext.Provider value={DEFAULT_SOURCE}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </DataSourceContext.Provider>
    </Router>
  );
}

installStaleChunkReload();

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
