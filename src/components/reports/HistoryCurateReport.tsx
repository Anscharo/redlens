// HTML-era history curation tool (plan §10.4). Walk the non-exact threading decisions
// one at a time, pick each document's previous version, and export a content-addressed
// decisions.json the build applies. The queue is commit-major — finish every change in
// one commit before the one before it — with ↑/↓ moving within a commit and ←/→ between
// commits. The offline auto-curator pre-fills the cases two independent signals agree on
// (baseline) and pre-computes frontier suggestions + reasoning for the uncertain residual
// (proposals), so the page makes NO LLM calls at runtime — it's a pure consumer of three
// static JSONs. Picks persist in localStorage. Data: public/history-curation.json.
import { useEffect, useMemo, useState } from "react";
import {
  loadCuration, loadPicks, savePicks, loadAutoDecisions, loadProposals, loadDecisions,
  downloadDecisions, saveDecisions, type CurationData, type Pick, type Proposal,
} from "../../lib/historyCuration";
import { orderedCases, commitBounds, adjacentCommit, commitInfo, autoLabel, caseCategory, CASE_FILTERS, type CaseFilter } from "../../lib/curationOrder";
import { CurationCase } from "./CurationCase";
import { CurationCommitStrip } from "./CurationCommitStrip";
import { CurationTimeline } from "./CurationTimeline";
import { useCurationKeys } from "./useCurationKeys";

export function HistoryCurateReport() {
  const [data, setData] = useState<CurationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [filter, setFilter] = useState<CaseFilter>("all");
  const [index, setIndex] = useState(0);
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [showChart, setShowChart] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  // case key -> mechanism that auto-resolved it (forward-reverse | containment | llm-90 | frontier)
  const [autoResolved, setAutoResolved] = useState<Map<string, string>>(new Map());
  // RAW baseline mechanism per case (not human-filtered) — drives the workflow filters.
  const [baselineMech, setBaselineMech] = useState<Map<string, string>>(new Map());

  // load the queue, the auto-resolved baseline, the frontier hints, and the COMMITTED human
  // decisions in parallel. Pick precedence: baseline < committed (in git) < localStorage scratch
  // (the live, unsaved session). The "auto-resolved" badge shows only where no human pick has
  // overridden the auto one — so the queue the human walks is just the residual.
  useEffect(() => {
    Promise.all([loadCuration(), loadAutoDecisions(), loadProposals(), loadDecisions()])
      .then(([d, auto, hints, committed]) => {
        setData(d);
        setProposals(hints);
        setBaselineMech(new Map(Object.entries(auto).map(([k, dec]) => [k, dec.auto])));
        const stored = loadPicks();
        const baseline: Record<string, Pick> = {};
        for (const [k, dec] of Object.entries(auto)) baseline[k] = dec.chosenKey;
        setPicks({ ...baseline, ...committed, ...stored });
        const humanPick = (k: string) => (stored[k] ?? committed[k]);
        setAutoResolved(new Map(
          Object.entries(auto)
            .filter(([k, dec]) => humanPick(k) === undefined || humanPick(k) === dec.chosenKey)
            .map(([k, dec]) => [k, dec.auto]),
        ));
      })
      .catch((e) => setError(String(e.message || e)));
  }, []);

  const save = async () => {
    if (!data) return;
    setSaveMsg("saving…");
    try {
      const n = await saveDecisions(data, picks, autoResolved);
      setSaveMsg(`saved ${n} → git commit public/history-decisions.json`);
    } catch (e) {
      setSaveMsg(`save failed (${String((e as Error)?.message || e)}) — use ⤓ export instead`);
    }
  };

  // workflow category per case (auto mechanism, or attention±hint) — for the filters + counts.
  const categoryOf = useMemo(() => {
    const hints = new Set(Object.keys(proposals));
    return (key: string): CaseFilter => caseCategory(key, baselineMech, hints.has(key));
  }, [baselineMech, proposals]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.cases.length ?? 0 };
    if (data) for (const k of data.cases) { const cat = categoryOf(k.key); c[cat] = (c[cat] ?? 0) + 1; }
    return c;
  }, [data, categoryOf]);
  const queue = useMemo(() => (data ? orderedCases(data, filter, categoryOf) : []), [data, filter, categoryOf]);
  const current = queue[index];
  const bounds = useMemo(() => commitBounds(queue, index), [queue, index]);
  const siblings = useMemo(() => queue.slice(bounds.start, bounds.end), [queue, bounds]);
  const decided = useMemo(() => (data ? data.cases.filter((c) => picks[c.key] !== undefined).length : 0), [data, picks]);

  const go = (delta: number) => setIndex((i) => Math.max(0, Math.min(queue.length - 1, i + delta)));
  // record a pick WITHOUT advancing — so you can keep reading candidates/neighbors
  const setPick = (key: string, value: Pick) => {
    setPicks((p) => { const next = { ...p, [key]: value }; savePicks(next); return next; });
  };

  const moveWithin = (dir: -1 | 1) => setIndex((i) => Math.max(bounds.start, Math.min(bounds.end - 1, i + dir)));
  const moveCommit = (dir: -1 | 1) => { const at = adjacentCommit(queue, index, dir); if (at != null) setIndex(at); };
  const jumpTo = (key: string) => { const at = queue.findIndex((c) => c.key === key); if (at >= 0) setIndex(at); };
  const jumpToCommit = (sha: string) => { const at = queue.findIndex((c) => c.newerSha === sha); if (at >= 0) setIndex(at); };
  const nextUndecided = () => { const at = queue.findIndex((c, i) => i > index && picks[c.key] === undefined); if (at >= 0) setIndex(at); };
  // confirm = commit the current decision and advance; if nothing was selected, accept the frontier suggestion.
  const confirm = () => {
    if (!current) return;
    if (picks[current.key] === undefined && proposals[current.key]) setPick(current.key, proposals[current.key].chosenKey);
    go(1);
  };

  useCurationKeys(!!current, current?.candidates.length ?? 0, {
    within: moveWithin, commit: moveCommit, confirm, none: () => current && setPick(current.key, "none"),
    select: (n) => current && setPick(current.key, current.candidates[n - 1].key),
  });

  if (error) return <div className="p-6" style={{ color: "var(--red)" }}>{error}</div>;
  if (!data) return <div className="p-6" style={{ color: "var(--tan-3)" }}>Loading curation cases…</div>;

  const isAuto = current && autoResolved.has(current.key);

  return (
    <div className="max-w-5xl mx-auto p-4">
      <header className="mb-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h1 className="text-xl" style={{ color: "var(--tan)" }}>HTML-era history — pick previous versions</h1>
          <span className="text-[13px]" style={{ color: "var(--tan-3)" }}>
            {decided} / {data.cases.length} decided
            {autoResolved.size > 0 && <span style={{ color: "var(--diff-added-fg)" }}> · {autoResolved.size} auto-resolved</span>}
          </span>
        </div>
        <div className="mt-2 flex gap-1.5 flex-wrap items-center">
          {CASE_FILTERS.map(({ id, label }) => (
            <button key={id} onClick={() => { setFilter(id); setIndex(0); }}
              className="text-[12px] px-2 py-0.5 rounded"
              style={{ background: filter === id ? "var(--accent)" : "var(--surface)", color: filter === id ? "var(--bg)" : "var(--tan-2)", border: "1px solid var(--border)" }}>
              {label} {counts[id] ?? 0}
            </button>
          ))}
          <button onClick={() => setShowChart((s) => !s)}
            className="text-[12px] px-2 py-0.5 rounded ml-auto"
            style={{ background: "var(--surface)", color: "var(--tan-2)", border: "1px solid var(--border)" }}>
            {showChart ? "▾ hide chart" : "▸ decisions per commit"}
          </button>
          <button onClick={save}
            className="text-[12px] px-2 py-0.5 rounded"
            style={{ background: "var(--accent)", color: "var(--bg)", border: "1px solid var(--accent)" }}>
            ⤒ save to repo
          </button>
          <button onClick={() => downloadDecisions(data, picks, autoResolved)}
            className="text-[12px] px-2 py-0.5 rounded"
            style={{ background: "var(--surface)", color: "var(--accent)", border: "1px solid var(--accent)" }}>
            ⤓ export decisions.json
          </button>
        </div>
        {saveMsg && <p className="mt-1 text-[12px]" style={{ color: "var(--tan-3)" }}>{saveMsg}</p>}
      </header>

      {showChart && <CurationTimeline data={data} onJump={jumpToCommit} />}

      {current ? (
        <>
          <CurationCommitStrip
            commit={commitInfo(data, current.newerSha)} siblings={siblings}
            currentKey={current.key} picks={picks} nodes={data.nodes} onJump={jumpTo}
          />
          <div className="flex items-center gap-3 mb-2 text-[12px]" style={{ color: "var(--tan-3)" }}>
            <button onClick={() => moveCommit(-1)} disabled={bounds.start === 0} className="px-2 py-0.5 rounded" style={{ border: "1px solid var(--border)" }}>◀ prev commit</button>
            <span>case {index + 1} / {queue.length}</span>
            <button onClick={() => moveCommit(1)} disabled={bounds.end >= queue.length} className="px-2 py-0.5 rounded" style={{ border: "1px solid var(--border)" }}>next commit ▶</button>
            <button onClick={nextUndecided} className="px-2 py-0.5 rounded ml-auto" style={{ border: "1px solid var(--border)" }}>skip to next undecided</button>
          </div>
          <button onClick={confirm} className="w-full mb-3 rounded py-2.5 text-sm font-semibold"
            style={{ background: isAuto ? "var(--diff-added-fg)" : "var(--accent)", color: "var(--bg)" }}>
            {isAuto ? `${autoLabel(autoResolved.get(current.key))} — ` : ""}
            Confirm{picks[current.key] === undefined && proposals[current.key] ? " (accept suggestion)" : picks[current.key] !== undefined ? " selection" : ""} &amp; next →
          </button>
          <CurationCase
            kase={current} nodes={data.nodes} pick={picks[current.key]}
            proposal={proposals[current.key] ?? null} proposalState="idle"
            onPick={(v) => setPick(current.key, v)}
          />
          <p className="mt-3 text-[11px]" style={{ color: "var(--tan-3)" }}>
            keys: <strong>↑/↓</strong> change in this commit · <strong>←/→</strong> commit · <strong>1–{Math.max(1, current.candidates.length)}</strong> select · <strong>0</strong> none · <strong>Enter</strong> confirm + next
          </p>
        </>
      ) : (
        <p style={{ color: "var(--tan-3)" }}>No cases for this filter.</p>
      )}
    </div>
  );
}
