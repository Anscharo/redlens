import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import "./index.css";
import App from "./App.tsx";
import { ErrorBoundary } from "./components/ErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary
      fallback={(error) => (
        <div className="flex flex-col items-center justify-center h-dvh gap-4 text-center px-4">
          <p className="text-sm mono" style={{ color: "var(--red)" }}>Something went wrong</p>
          <p className="text-xs mono text-tan-3 max-w-md">{error.message}</p>
          <a href={import.meta.env.BASE_URL} className="text-xs mono text-accent hover:underline">← home</a>
        </div>
      )}
    >
      <Router base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <App />
      </Router>
    </ErrorBoundary>
  </StrictMode>,
);
