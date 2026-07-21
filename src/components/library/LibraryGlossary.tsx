import { useEffect, useState } from "react";
import { loadGlossary, type GlossaryEntry } from "../../lib/glossary";
import { Link } from "../Link";
import { atlasHref } from "../../lib/routes";

export function LibraryGlossary() {
  const [terms, setTerms] = useState<GlossaryEntry[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let on = true;
    loadGlossary()
      .then((g) => {
        if (!on) return;
        const flat = Object.values(g).flat();
        flat.sort((a, b) => a.term.localeCompare(b.term));
        setTerms(flat);
      })
      .catch(() => on && setError(true));
    return () => {
      on = false;
    };
  }, []);

  if (error) return <p className="text-sm mono" style={{ color: "var(--error-text)" }}>glossary failed to load</p>;
  if (!terms) return <p className="text-sm mono text-tan-3">loading…</p>;

  return (
    <div>
      <p className="text-xs mb-6" style={{ color: "var(--tan-3)" }}>
        {terms.length} terms extracted from the Atlas&apos;s Definitions sections. Each links to its source document.
      </p>
      {terms.map((t) => (
        <article key={`${t.term}-${t.nodeId}`} className="mb-6">
          <h2 className="text-sm font-semibold mb-1" style={{ color: "var(--tan)" }}>
            {t.term}
          </h2>
          <p className="text-sm mb-1" style={{ color: "var(--tan-2)" }}>
            {t.content}
          </p>
          <Link to={atlasHref(t.nodeId)} className="mono text-xs link-accent">
            {t.sourceDocNo || t.docNo} →
          </Link>
        </article>
      ))}
    </div>
  );
}
