import { useEffect, useState } from "react";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { Link } from "../Link";
import { ROUTES } from "../../lib/routes";
import { loadLibrary, type LibraryData } from "../../lib/library";
import { LibraryShape } from "./LibraryShape";
import { LibraryContents } from "./LibraryContents";
import { LibraryGlossary } from "./LibraryGlossary";
import { LibraryConcepts, LibraryAudit } from "./LibraryConcepts";

export type LibraryTab = "shape" | "contents" | "concepts" | "audit" | "glossary";

const TABS: { tab: LibraryTab; label: string; to: string }[] = [
  { tab: "shape", label: "Shape", to: ROUTES.LIBRARY },
  { tab: "contents", label: "Contents", to: ROUTES.LIBRARY_CONTENTS },
  { tab: "concepts", label: "Concepts", to: ROUTES.LIBRARY_CONCEPTS },
  { tab: "audit", label: "Audit", to: ROUTES.LIBRARY_AUDIT },
  { tab: "glossary", label: "Glossary", to: ROUTES.LIBRARY_GLOSSARY },
];

export function LibraryPage({ tab }: { tab: LibraryTab }) {
  useDocumentTitle("Library — Sky Atlas by Redline");
  const [data, setData] = useState<LibraryData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    loadLibrary()
      .then((d) => on && setData(d))
      .catch((e) => on && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      on = false;
    };
  }, []);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">library</p>
        <h1 className="text-xl font-semibold mb-2" style={{ color: "var(--tan)" }}>
          Atlas Library
        </h1>
        <p className="text-sm mb-6" style={{ color: "var(--tan-2)" }}>
          A scholarly layer over the Atlas: its functional chunks, how much weight each carries, and the terms it
          defines — instead of one monolith document or a pile of disconnected sections.
        </p>
        <nav className="flex gap-2 mb-8" aria-label="Library pages">
          {TABS.map((t) => (
            <Link
              key={t.tab}
              to={t.to}
              className="mono text-xs px-3 py-1.5 rounded"
              style={
                t.tab === tab
                  ? { background: "var(--hover)", color: "var(--tan)" }
                  : { color: "var(--tan-3)" }
              }
            >
              {t.label}
            </Link>
          ))}
        </nav>
        {tab === "glossary" ? (
          <LibraryGlossary />
        ) : tab === "concepts" ? (
          <LibraryConcepts />
        ) : tab === "audit" ? (
          <LibraryAudit />
        ) : error ? (
          <p className="text-sm mono" style={{ color: "var(--error-text)" }}>
            library data failed to load: {error}
          </p>
        ) : !data ? (
          <p className="text-sm mono text-tan-3">loading…</p>
        ) : tab === "shape" ? (
          <LibraryShape data={data} />
        ) : (
          <LibraryContents toc={data.toc} neededResearch={data.neededResearch} />
        )}
      </div>
    </div>
  );
}
