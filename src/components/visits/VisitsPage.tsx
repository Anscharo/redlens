import { useEffect, useMemo, useState } from "react";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { loadDocs } from "../../lib/docs";
import { useDataSource } from "../../lib/dataSource";
import { clearHistory, useVisitLog } from "../../lib/visitHistory";
import {
  buildHistoryView,
  RECENT_DOCS,
  RECENT_PAGES,
  TOP_DOCS,
  TOP_TREES,
} from "../../lib/historyIndex";
import { track } from "../../lib/analytics";
import type { AtlasNode } from "../../types";
import { VisitCard } from "./VisitCard";
import { DocRow } from "./VisitRow";
import { TreeRows } from "./TreeRows";
import { PageRows } from "./PageRows";

// /history — what this browser has been reading. Everything here is derived
// from the local IndexedDB visit log (src/lib/visitHistory.ts): no account, no
// server call, nothing to sign in for. Doc titles and numbers are refreshed
// against docs.json when it lands, but the page renders from the log alone
// first, so it never waits on the atlas bundle.
export function VisitsPage() {
  useDocumentTitle("Your Viewing History");
  const { base } = useDataSource();
  const { events, loaded } = useVisitLog();
  const [docs, setDocs] = useState<Record<string, AtlasNode> | null>(null);

  useEffect(() => {
    let alive = true;
    loadDocs(base)
      .then((d) => alive && setDocs(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [base]);

  const view = useMemo(() => buildHistoryView(events, docs), [events, docs]);

  const clear = async () => {
    if (!window.confirm("Clear your viewing history in this browser? This can't be undone.")) return;
    await clearHistory();
    track("history_clear");
  };

  return (
    <div className="px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <p className="mono text-xs text-tan-3 mb-1">history</p>
        <div className="flex items-baseline justify-between gap-4 mb-2">
          <h1 className="text-xl font-semibold" style={{ color: "var(--tan)" }}>
            Your Viewing History
          </h1>
          {!view.empty && (
            <button
              type="button"
              onClick={clear}
              className="mono text-[11px] px-2 py-1 rounded border transition-colors hover:bg-[var(--hover)] shrink-0"
              style={{ borderColor: "var(--border)", color: "var(--tan-3)" }}
            >
              clear history
            </button>
          )}
        </div>
        <p className="mono text-[10px] mb-6" style={{ color: "var(--gray)" }}>
          Kept in this browser only — never sent to a server, and not tied to an account.
          Visits older than 180 days are forgotten.
        </p>

        {!loaded ? (
          <p className="mono text-xs text-tan-3">Loading…</p>
        ) : view.empty ? (
          <p className="mono text-xs text-tan-3">
            No history yet — read a document, open a report, or visit an actor on the Radar,
            and it will show up here.
          </p>
        ) : (
          <div className="space-y-4">
            <VisitCard
              title="Recently viewed documents"
              blurb={`the last ${RECENT_DOCS} Atlas documents you opened, newest first`}
              empty={view.recentDocs.length === 0}
            >
              {view.recentDocs.map((d) => (
                <DocRow key={d.id} path={d.path} docNo={d.docNo} label={d.label} count={d.count} />
              ))}
            </VisitCard>

            <VisitCard
              title="Most viewed documents"
              blurb={`your top ${TOP_DOCS} Atlas documents by number of visits`}
              empty={view.topDocs.length === 0}
            >
              {view.topDocs.map((d) => (
                <DocRow key={d.id} path={d.path} docNo={d.docNo} label={d.label} count={d.count} />
              ))}
            </VisitCard>

            <VisitCard
              title="Most viewed document trees"
              blurb={`your top ${TOP_TREES} areas of the Atlas, grouped by document number — open one to see the documents behind its count`}
              empty={view.topTrees.length === 0}
            >
              <TreeRows trees={view.topTrees} />
            </VisitCard>

            <VisitCard
              title="Recently viewed reports & radar"
              blurb={`the last ${RECENT_PAGES} report and Radar pages you opened, with the filters you had set`}
              empty={view.recentPages.length === 0}
            >
              <PageRows pages={view.recentPages} />
            </VisitCard>
          </div>
        )}
      </div>
    </div>
  );
}
