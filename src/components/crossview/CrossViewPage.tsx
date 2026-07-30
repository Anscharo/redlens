import { useEffect, useState } from "react";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { Link } from "../Link";
import { ROUTES } from "../../lib/routes";
import { track } from "../../lib/analytics";
import { loadCrossView, type CrossViewData } from "../../lib/crossview";
import { useDataSource } from "../../lib/dataSource";
import { CrossViewShape } from "./CrossViewShape";
import { CrossViewGlossary } from "./CrossViewGlossary";
import { CrossViewConcepts, CrossViewAudit } from "./CrossViewConcepts";
import { CrossViewToc } from "./CrossViewToc";
import { CrossViewTopicIndex } from "./CrossViewTopicIndex";

export type CrossViewTab = "shape" | "concepts" | "audit" | "glossary";

const TABS: { tab: CrossViewTab; label: string; to: string }[] = [
  { tab: "shape", label: "Shape", to: ROUTES.REPORTS_CROSSVIEW },
  { tab: "concepts", label: "Concepts", to: ROUTES.REPORTS_CROSSVIEW_CONCEPTS },
  { tab: "audit", label: "Audit", to: ROUTES.REPORTS_CROSSVIEW_AUDIT },
  { tab: "glossary", label: "Glossary", to: ROUTES.REPORTS_CROSSVIEW_GLOSSARY },
];

export function CrossViewPage({ tab }: { tab: CrossViewTab }) {
  useDocumentTitle("Atlas CrossView: Sky Atlas by Redline");
  const { base } = useDataSource();
  const [data, setData] = useState<CrossViewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    track("report_view", { report: "crossview" });
  }, []);
  useEffect(() => {
    let on = true;
    loadCrossView(base)
      .then((d) => on && setData(d))
      .catch((e) => on && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      on = false;
    };
  }, [base]);

  return (
    <div className="flex-1 px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">crossview</p>
        <h1 className="text-xl font-semibold mb-2" style={{ color: "var(--tan)" }}>
          Atlas CrossView
        </h1>
        <p className="text-sm mb-6" style={{ color: "var(--tan-2)" }}>
          Alternate categorizations of the Atlas: its functional chunks, how much weight each carries, and the terms it
          defines — instead of one monolith document or a pile of disconnected sections.
        </p>
        <nav className="flex gap-2 mb-8" aria-label="CrossView pages">
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
      </div>
      {/* Concepts gets its own (wider, lg+ only) row so a left TOC column fits
          beside the max-w-3xl article measure; every other tab keeps the
          plain centered 3xl column above unchanged. Below lg (TOC hidden),
          this collapses back to the identical max-w-3xl mx-auto layout. At
          xl+ a third column (CrossViewTopicIndex, the right-hand "Topics"
          panel) joins in — both side columns hide themselves below their
          own breakpoint via their own classes, so this row just widens the
          cap to fit all three at xl. */}
      <div
        className={
          tab === "concepts"
            ? "max-w-3xl lg:max-w-[62rem] xl:max-w-[80rem] mx-auto lg:flex lg:gap-8 lg:items-start"
            : "max-w-3xl mx-auto"
        }
      >
        {tab === "concepts" && <CrossViewToc />}
        <div className={tab === "concepts" ? "max-w-3xl lg:min-w-0 lg:flex-1" : undefined}>
          {tab === "glossary" ? (
            <CrossViewGlossary />
          ) : tab === "concepts" ? (
            <CrossViewConcepts />
          ) : tab === "audit" ? (
            <CrossViewAudit />
          ) : error ? (
            <p className="text-sm mono" style={{ color: "var(--error-text)" }}>
              crossview data failed to load: {error}
            </p>
          ) : !data ? (
            <p className="text-sm mono text-tan-3">loading…</p>
          ) : (
            <CrossViewShape data={data} />
          )}
        </div>
        {tab === "concepts" && <CrossViewTopicIndex />}
      </div>
    </div>
  );
}
