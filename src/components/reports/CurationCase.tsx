// One curation decision: a NEWER document and its candidate PREVIOUS versions.
// Selecting a candidate previews its FULL content side-by-side with the subject (plus
// a diff) — it does NOT advance, so you can read every candidate before confirming.
// "none — created here" records that the newer doc has no predecessor.
import { useMemo } from "react";
import { lineDiff } from "../../lib/diffCore";
import { DiffView } from "../history/DiffView";
import { ContextColumn } from "./CurationContext";
import type { CurationCase as Case, CurationNode, Pick, Proposal } from "../../lib/historyCuration";

const short = (sha: string) => sha.slice(0, 7);

function Badge({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <span className="shrink-0 text-[10px] uppercase px-1 py-0.5 rounded"
      style={{ background: accent ? "var(--accent)" : "var(--hover)", color: accent ? "var(--bg)" : "var(--tan-3)" }}>
      {label}
    </span>
  );
}

export function CurationCase({
  kase, nodes, pick, proposal, proposalState, proposalError, onPick,
}: {
  kase: Case;
  nodes: Record<string, CurationNode>;
  pick: Pick | undefined;
  proposal: Proposal | null;
  proposalState: "idle" | "loading" | "error";
  proposalError?: string;
  onPick: (key: Pick) => void;
}) {
  const subject = nodes[kase.subjectKey];
  const selected = pick && pick !== "none" ? nodes[pick] : null;
  const diff = useMemo(
    () => (selected ? lineDiff(selected.content, subject.content) : null),
    [selected, subject.content],
  );
  // each side's local window (focal + neighbors) — passed to the OTHER column so its
  // nearby entries can be flagged +/Δ/− relative to this one.
  const windowOf = (n: CurationNode) => [n, ...(n.prev || []), ...(n.next || [])].flatMap((x) => (typeof x === "string" ? [nodes[x]] : [x])).filter(Boolean) as CurationNode[];
  const newerWindow = windowOf(subject);
  const olderWindow = selected ? windowOf(selected) : undefined;

  return (
    <section>
      <header className="flex items-baseline gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-wide px-1.5 py-0.5 rounded"
          style={{ background: "var(--hover)", color: "var(--accent)" }}>{kase.kind}</span>
        <h2 className="text-lg" style={{ color: "var(--tan)" }}>{subject.title || "(untitled)"}</h2>
        {subject.type && <span className="text-[12px]" style={{ color: "var(--tan-3)" }}>&lt;{subject.type}&gt;</span>}
        <span className="text-[12px] mono" style={{ color: "var(--tan-3)" }}>
          {subject.doc_no || "—"} · newer {short(kase.newerSha)}
        </span>
      </header>

      <p className="mt-3 mb-1 text-[13px]" style={{ color: "var(--tan-3)" }}>
        Pick its previous version (older commit {short(kase.olderSha)}) — click a candidate to read it:
      </p>

      {/* LLM proposal banner */}
      <div className="mb-2 text-[12px]" style={{ color: "var(--tan-3)" }}>
        {proposalState === "loading" && <span>LLM is proposing…</span>}
        {proposalState === "error" && <span style={{ color: "var(--red)" }}>LLM proposal failed{proposalError ? ` — ${proposalError}` : ""}</span>}
        {proposalState === "idle" && proposal && (
          <span>
            LLM suggests:{" "}
            <strong style={{ color: "var(--accent)" }}>
              {proposal.chosenKey === "none" ? "none (created here)" : nodes[proposal.chosenKey]?.title || proposal.chosenKey}
            </strong>
            {proposal.why ? ` — ${proposal.why}` : ""}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {kase.candidates.map((cand) => {
          const node = nodes[cand.key];
          const isPick = pick === cand.key;
          return (
            <button key={cand.key} onClick={() => onPick(cand.key)}
              className="flex items-center gap-2 text-left rounded px-2 py-1.5 text-[13px]"
              style={{
                background: isPick ? "color-mix(in srgb, var(--accent) 16%, transparent)" : "var(--surface)",
                border: `1px solid ${isPick ? "var(--accent)" : "var(--border)"}`,
                color: "var(--tan)",
              }}>
              <span className="shrink-0 w-10 mono text-[11px]" style={{ color: "var(--tan-3)" }}>
                {(cand.score * 100).toFixed(0)}%
              </span>
              <span className="flex-1">{node?.title || cand.key}</span>
              {cand.key === kase.autoKey && <Badge label="auto" />}
              {proposal?.chosenKey === cand.key && <Badge label="LLM" accent />}
            </button>
          );
        })}
        <button onClick={() => onPick("none")}
          className="text-left rounded px-2 py-1.5 text-[13px]"
          style={{
            background: pick === "none" ? "color-mix(in srgb, var(--accent) 16%, transparent)" : "var(--surface)",
            border: `1px solid ${pick === "none" ? "var(--accent)" : "var(--border)"}`,
            color: "var(--tan-2)",
          }}>
          none — created at this commit
        </button>
      </div>

      {/* full content in context, oldest→newest left→right: the selected previous
          version (+ neighbors) on the LEFT, the newer subject (+ neighbors) on the
          RIGHT — the surrounding entries disambiguate near-identical siblings. */}
      <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
        {selected ? (
          <ContextColumn label="previous version (older) — with nearby entries" node={selected} nodes={nodes} compareTo={newerWindow} role="older" />
        ) : (
          <div className="flex items-center justify-center rounded text-[12px] min-h-[6rem]"
            style={{ border: "1px dashed var(--border)", color: "var(--tan-3)" }}>
            {pick === "none" ? "marked as created here — no previous version" : "select a candidate to read it in context"}
          </div>
        )}
        <ContextColumn label="this version (newer) — with nearby entries" node={subject} nodes={nodes} compareTo={olderWindow} role="newer" />
      </div>

      {diff && (
        <div className="mt-3">
          <p className="text-[12px] mb-1" style={{ color: "var(--tan-3)" }}>diff (previous → this version):</p>
          <DiffView lines={diff} />
        </div>
      )}
    </section>
  );
}
