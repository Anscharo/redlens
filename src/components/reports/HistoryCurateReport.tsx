// HTML-era history curation tool (plan §10.4). Walk the non-exact threading
// decisions one at a time, pick each document's previous version (LLM proposes, you
// confirm), and export a content-addressed decisions.json the build applies. Picks
// persist in localStorage. Data: public/history-curation.json (built offline by
// scripts/aux/build-history-curation.mjs).
import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadCuration, loadPicks, savePicks, downloadDecisions, proposePredecessor,
  type CurationData, type Pick, type Proposal,
} from "../../lib/historyCuration";
import { CurationCase } from "./CurationCase";

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
  const requested = useRef<Set<string>>(new Set());

  useEffect(() => {
    loadCuration().then((d) => { setData(d); setPicks(loadPicks()); }).catch((e) => setError(String(e.message || e)));
  }, []);

  const queue = useMemo(
    () => (data ? data.cases.filter((c) => kind === "all" || c.kind === kind) : []),
    [data, kind],
  );
  const current = queue[index];
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

  // record a pick WITHOUT advancing — so you can keep reading candidates/neighbors
  const setPick = (key: string, value: Pick) => {
    setPicks((p) => { const next = { ...p, [key]: value }; savePicks(next); return next; });
  };
  const go = (delta: number) => setIndex((i) => Math.max(0, Math.min(queue.length - 1, i + delta)));
  const nextUndecided = () => {
    const at = queue.findIndex((c, i) => i > index && picks[c.key] === undefined);
    if (at >= 0) setIndex(at);
  };
  // confirm = commit the current decision and advance; if nothing was selected, accept
  // the LLM's proposed predecessor.
  const confirm = () => {
    if (!current) return;
    if (picks[current.key] === undefined && proposals[current.key]) setPick(current.key, proposals[current.key].chosenKey);
    go(1);
  };

  // keyboard: 1–9 select a candidate (preview only), 0 none, Enter confirm + next
  // (accepts the LLM pick if you haven't chosen), ←/→ move between cases.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!current) return;
      if (e.key === "ArrowLeft") return go(-1);
      if (e.key === "ArrowRight") return go(1);
      if (e.key === "Enter") return confirm();
      if (e.key === "0") return setPick(current.key, "none");
      const n = Number(e.key);
      if (n >= 1 && n <= current.candidates.length) setPick(current.key, current.candidates[n - 1].key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, proposals, picks, queue.length]);

  if (error) return <div className="p-6" style={{ color: "var(--red)" }}>{error}</div>;
  if (!data) return <div className="p-6" style={{ color: "var(--tan-3)" }}>Loading curation cases…</div>;

  const kinds = ["all", ...Object.keys((data.meta.casesByKind as Record<string, number>) || {})];

  return (
    <div className="max-w-5xl mx-auto p-4">
      <header className="mb-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <h1 className="text-xl" style={{ color: "var(--tan)" }}>HTML-era history — pick previous versions</h1>
          <span className="text-[13px]" style={{ color: "var(--tan-3)" }}>{decided} / {data.cases.length} decided</span>
        </div>
        <div className="mt-2 flex gap-1.5 flex-wrap">
          {kinds.map((k) => (
            <button key={k} onClick={() => { setKind(k); setIndex(0); }}
              className="text-[12px] px-2 py-0.5 rounded"
              style={{ background: kind === k ? "var(--accent)" : "var(--surface)", color: kind === k ? "var(--bg)" : "var(--tan-2)", border: "1px solid var(--border)" }}>
              {k}
            </button>
          ))}
          <button onClick={() => downloadDecisions(data, picks)}
            className="text-[12px] px-2 py-0.5 rounded ml-auto"
            style={{ background: "var(--surface)", color: "var(--accent)", border: "1px solid var(--accent)" }}>
            ⤓ export decisions.json
          </button>
        </div>
      </header>

      {current ? (
        <>
          <div className="flex items-center gap-3 mb-2 text-[12px]" style={{ color: "var(--tan-3)" }}>
            <button onClick={() => go(-1)} disabled={index === 0} className="px-2 py-0.5 rounded" style={{ border: "1px solid var(--border)" }}>◀ prev</button>
            <span>{index + 1} / {queue.length}</span>
            <button onClick={() => go(1)} disabled={index >= queue.length - 1} className="px-2 py-0.5 rounded" style={{ border: "1px solid var(--border)" }}>next ▶</button>
            <button onClick={nextUndecided} className="px-2 py-0.5 rounded ml-auto" style={{ border: "1px solid var(--border)" }}>skip to next undecided</button>
          </div>
          <button onClick={confirm} className="w-full mb-3 rounded py-2.5 text-sm font-semibold"
            style={{ background: "var(--accent)", color: "var(--bg)" }}>
            Confirm{picks[current.key] === undefined && proposals[current.key] ? " (accept LLM pick)" : picks[current.key] !== undefined ? " selection" : ""} &amp; next →
          </button>
          <CurationCase
            kase={current} nodes={data.nodes} pick={picks[current.key]}
            proposal={proposals[current.key] ?? null} proposalState={pState[current.key] ?? "idle"}
            proposalError={pError[current.key]}
            onPick={(v) => setPick(current.key, v)}
          />
          <p className="mt-3 text-[11px]" style={{ color: "var(--tan-3)" }}>
            keys: <strong>1–{Math.max(1, current.candidates.length)}</strong> select (preview) · <strong>0</strong> none · <strong>Enter</strong> confirm + next · <strong>←/→</strong> move
          </p>
        </>
      ) : (
        <p style={{ color: "var(--tan-3)" }}>No cases for this filter.</p>
      )}
    </div>
  );
}
