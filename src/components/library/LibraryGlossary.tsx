import { useEffect, useMemo, useState } from "react";
import { loadGlossary, type GlossaryEntry } from "../../lib/glossary";
import { Link } from "../Link";
import { atlasHref } from "../../lib/routes";
import { useDataSource } from "../../lib/dataSource";
import { makeSlugger } from "../../lib/slug";
import { anchorFor } from "./libraryMarkdownComponents";

export function LibraryGlossary() {
  const { base } = useDataSource();
  const [terms, setTerms] = useState<GlossaryEntry[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let on = true;
    loadGlossary(base)
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
  }, [base]);

  // One id per term ("#stability-fee"-style), deduped in the same displayed
  // order the terms render in — same slugger convention as the Concepts/Audit
  // heading ids (slug.ts), independently derived since the glossary isn't
  // markdown-rendered.
  const slugs = useMemo(() => {
    const slugger = makeSlugger();
    return (terms ?? []).map((t) => slugger(t.term));
  }, [terms]);

  // Client-side nav to "#slug" (e.g. a Link elsewhere in the app) never fires
  // the browser's own fragment scroll, since it isn't a full navigation —
  // mirrors ActorDashboard.tsx's radar precedent and LibraryMarkdown's.
  useEffect(() => {
    if (!terms) return;
    const hash = window.location.hash.slice(1);
    if (!hash) return;
    document.getElementById(hash)?.scrollIntoView({ behavior: "instant", block: "start" });
  }, [terms]);

  if (error) return <p className="text-sm mono" style={{ color: "var(--error-text)" }}>glossary failed to load</p>;
  if (!terms) return <p className="text-sm mono text-tan-3">loading…</p>;

  return (
    <div>
      <p className="text-xs mb-6" style={{ color: "var(--tan-3)" }}>
        {terms.length} terms extracted from the Atlas&apos;s Definitions sections. Each links to its source document.
      </p>
      {terms.map((t, i) => (
        <article key={`${t.term}-${t.nodeId}`} className="mb-6">
          <h2 id={slugs[i]} className="text-sm font-semibold mb-1 heading-with-anchor" style={{ color: "var(--tan)" }}>
            {t.term}
            {anchorFor(slugs[i])}
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
