// HTML-era history curation tool (plan §10.4). Walk the non-exact threading
// decisions one at a time, pick each document's previous version (LLM proposes, you
// confirm), and export a content-addressed decisions.json the build applies. The
// queue is commit-major — finish every change in one commit before the one before it
// — with ↑/↓ moving within a commit and ←/→ between commits. When the LLM and a
// >95%-confidence candidate agree, the case auto-resolves. Picks persist in
// localStorage. Data: public/history-curation.json (scripts/aux/build-history-curation.mjs).
import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadCuration, loadPicks, savePicks, loadAutoDecisions, downloadDecisions, proposePredecessor,
  type CurationData, type Pick, type Proposal,
} from "../../lib/historyCuration";
import { orderedCases, commitBounds, adjacentCommit, commitInfo, autoSelectKey, autoLabel } from "../../lib/curationOrder";
import { CurationCase } from "./CurationCase";
import { CurationCommitStrip } from "./CurationCommitStrip";
import { useCurationKeys } from "./useCurationKeys";

type PState = "idle" | "loading" | "error";

export function HistoryCurateReport() {
  const [data, setData] = useState<CurationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [kind, setKind] = useState<string>("all");
  const [index, setIndex] = useState(0);
  const [proposals, setProposals] = useState<Record<string, Proposal>>({});
  const [pState, setPState] = useState<Record<string, PState>>({});
  const [pError, setPError] = useState<Record<string, string>>({});
  const [autoAdvance, setAutoAdvance] = useState(true);
  // case key -> mechanism that auto-resolved it ("forward-reverse" | "llm-90" | "llm-95")
  const [autoResolved, setAutoResolved] = useState<Map<string, string>>(new Map());
  const requested = useRef<Set<string>>(new Set());

  // load the queue + the offline auto-resolved baseline, and pre-fill the cases two
  // independent signals already agree on — without overriding a stored human pick — so
  // the queue the human actually walks is only the residual.
  useEffect(() => {
    Promise.all([loadCuration(), loadAutoDecisions()])
      .then(([d, auto]) => {
        setData(d);
        const stored = loadPicks();
        const baseline: Record<string, Pick> = {};
        for (const [k, dec] of Object.entries(auto)) baseline[k] = dec.chosenKey;
        setPicks({ ...baseline, ...stored }); // stored (human) wins over the baseline
        setAutoResolved(new Map(Object.entries(auto).filter(([k]) => stored[k] === undefined).map(([k, dec]) => [k, dec.auto])));
      })
      .catch((e) => setError(String(e.message || e)));
  }, []);

  const queue = useMemo(() => (data ? orderedCases(data, kind) : []), [data, kind]);
  const current = queue[index];
  const bounds = useMemo(() => commitBounds(queue, index), [queue, index]);
  const siblings = useMemo(() => queue.slice(bounds.start, bounds.end), [queue, bounds]);
  const decided = useMemo(() => (data ? data.cases.filter((c) => picks[c.key] !== undefined).length : 0), [data, picks]);

  // lazy LLM proposal for the current, not-yet-decided case
  useEffect(() => {
    if (!data || !current || requested.current.has(current.key)) return;
    requested.current.add(current.key);
    setPState((s) => ({ ...s, [current.key]: "loading" }));
    const cands = current.candidates.map((c) => ({ key: c.key, node: data.nodes[c.key] }));
    proposePredecessor(data.nodes[current.subjectKey], cands)
      .then((p) => { setProposals((m) => ({ ...m, [current.key]: p })); setPState((s) => ({ ...s, [current.key]: "idle" })); })
      .catch((e) => { setPError((m) => ({ ...m, [current.key]: String(e?.message || e) })); setPState((s) => ({ ...s, [current.key]: "error" })); });
  }, [data, current]);

  const go = (delta: number) => setIndex((i) => Math.max(0, Math.min(queue.length - 1, i + delta)));
  // record a pick WITHOUT advancing — so you can keep reading candidates/neighbors
  const setPick = (key: string, value: Pick) => {
    setPicks((p) => { const next = { ...p, [key]: value }; savePicks(next); return next; });
  };

  // auto-resolve: when the LLM and a >95%-confidence candidate name the SAME older
  // doc, record that pick. Advances past it too when auto-advance is on, so the human
  // only stops on genuinely ambiguous cases. Never overrides a human/prior decision.
  useEffect(() => {
    if (!current) return;
    const key = autoSelectKey(current, proposals[current.key]);
    if (!key || picks[current.key] !== undefined) return;
    setPick(current.key, key);
    setAutoResolved((s) => (s.has(current.key) ? s : new Map(s).set(current.key, "llm-95")));
    if (autoAdvance) go(1);
  }, [current, proposals, picks, autoAdvance]);

  const moveWithin = (dir: -1 | 1) => setIndex((i) => Math.max(bounds.start, Math.min(bounds.end - 1, i + dir)));
  const moveCommit = (dir: -1 | 1) => { const at = adjacentCommit(queue, index, dir); if (at != null) setIndex(at); };
  const jumpTo = (key: string) => { const at = queue.findIndex((c) => c.key === key); if (at >= 0) setIndex(at); };
  const nextUndecided = () => { const at = queue.findIndex((c, i) => i > index && picks[c.key] === undefined); if (at >= 0) setIndex(at); };
  // confirm = commit the current decision and advance; if nothing was selected, accept the LLM's proposal.
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

  const kinds = ["all", ...Object.keys((data.meta.casesByKind as Record<string, number>) || {})];
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
          {kinds.map((k) => (
            <button key={k} onClick={() => { setKind(k); setIndex(0); }}
              className="text-[12px] px-2 py-0.5 rounded"
              style={{ background: kind === k ? "var(--accent)" : "var(--surface)", color: kind === k ? "var(--bg)" : "var(--tan-2)", border: "1px solid var(--border)" }}>
              {k}
            </button>
          ))}
          <label className="text-[12px] flex items-center gap-1 ml-auto cursor-pointer" style={{ color: "var(--tan-2)" }}>
            <input type="checkbox" checked={autoAdvance} onChange={(e) => setAutoAdvance(e.target.checked)} />
            ⚡ auto-advance on LLM + 95% agreement
          </label>
          <button onClick={() => downloadDecisions(data, picks)}
            className="text-[12px] px-2 py-0.5 rounded"
            style={{ background: "var(--surface)", color: "var(--accent)", border: "1px solid var(--accent)" }}>
            ⤓ export decisions.json
          </button>
        </div>
      </header>

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
            Confirm{picks[current.key] === undefined && proposals[current.key] ? " (accept LLM pick)" : picks[current.key] !== undefined ? " selection" : ""} &amp; next →
          </button>
          <CurationCase
            kase={current} nodes={data.nodes} pick={picks[current.key]}
            proposal={proposals[current.key] ?? null} proposalState={pState[current.key] ?? "idle"}
            proposalError={pError[current.key]}
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
