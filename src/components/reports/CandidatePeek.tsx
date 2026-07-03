// Floating panel: the OTHER documents that also list a given candidate as a possible previous
// version. Since candidates are occurrence-keyed, a shared candidate is a genuine contention —
// the same older row can be the predecessor of at most ONE document. Shows, per competing doc,
// how the candidate scores there, whether it's already been chosen (a conflict to resolve), and
// a jump to curate it. Read-only; the pick stays in the main pane.
import { nodeLabel, type CurationData, type CurationNode, type Pick } from "../../lib/historyCuration";

const pathOf = (n?: CurationNode) => (n ? [n.section, ...(n.ancestors || [])].filter(Boolean).join(" › ") : "");

export function CandidatePeek({
  candKey, caseKeys, data, picks, onOpen, onClose,
}: {
  candKey: string;
  caseKeys: string[]; // OTHER cases (current one excluded) that list this candidate
  data: CurationData;
  picks: Record<string, Pick>;
  onOpen: (caseKey: string) => void;
  onClose: () => void;
}) {
  const cand = data.nodes[candKey];
  const others = caseKeys.map((k) => data.cases.find((c) => c.key === k)).filter((c): c is NonNullable<typeof c> => !!c);
  const path = pathOf(cand);

  return (
    <aside className="fixed top-16 right-3 bottom-3 w-[380px] z-40 flex flex-col rounded"
      style={{ background: "var(--surface)", border: "1px solid var(--accent)", boxShadow: "0 8px 40px rgba(0,0,0,0.5)" }}>
      <header className="flex items-start gap-2 p-3" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wide" style={{ color: "var(--tan-3)" }}>
            shared candidate · contended by {others.length} other doc{others.length === 1 ? "" : "s"}
          </p>
          <p className="text-[13px]" style={{ color: "var(--tan)" }}>{cand ? nodeLabel(cand) : candKey}</p>
          {cand?.scope && <p className="text-[11px]" style={{ color: "var(--accent)" }}>scope: {cand.scope}</p>}
          {cand?.parentTitle && <p className="text-[11px] truncate" style={{ color: "var(--tan-3)" }} title={cand.parentTitle}>under: {cand.parentTitle}</p>}
          {path && <p className="text-[11px] mono truncate" style={{ color: "var(--tan-3)" }} title={path}>{path}</p>}
        </div>
        <button onClick={onClose} className="shrink-0 text-[13px] px-1.5 rounded" style={{ color: "var(--tan-3)", border: "1px solid var(--border)" }} title="close">✕</button>
      </header>

      <div className="flex-1 overflow-auto p-3 flex flex-col gap-2">
        {others.map((c) => {
          const subj = data.nodes[c.subjectKey];
          const score = c.candidates.find((x) => x.key === candKey)?.score ?? 0;
          const pick = picks[c.key];
          const chosenHere = pick === candKey; // this candidate is ALREADY the pick here → conflict
          const decidedOther = pick !== undefined && !chosenHere;
          return (
            <article key={c.key} className="rounded p-2" style={{ border: `1px solid ${chosenHere ? "var(--red)" : "var(--border)"}`, background: "var(--bg)" }}>
              <div className="flex items-baseline gap-2">
                <span className="mono text-[11px] shrink-0" style={{ color: "var(--tan-3)" }}>{subj?.doc_no || "—"}</span>
                <span className="flex-1 text-[13px] truncate" style={{ color: "var(--tan)" }}>{subj ? nodeLabel(subj) : "(untitled)"}</span>
                {subj?.scope && (
                  <span className="text-[10px] px-1 py-0.5 rounded shrink-0"
                    title={cand?.scope ? (subj.scope === cand.scope ? "same scope as the candidate" : "different scope from the candidate") : `scope: ${subj.scope}`}
                    style={{ background: cand?.scope && subj.scope === cand.scope ? "color-mix(in srgb, var(--diff-added-fg) 22%, transparent)" : "var(--hover)", color: cand?.scope && subj.scope === cand.scope ? "var(--diff-added-fg)" : "var(--tan-3)" }}>
                    {cand?.scope && subj.scope === cand.scope ? "✓ " : ""}{subj.scope}
                  </span>
                )}
                <span className="text-[10px] uppercase px-1 py-0.5 rounded shrink-0" style={{ background: "var(--hover)", color: "var(--tan-3)" }}>{c.kind}</span>
              </div>
              <p className="text-[11px] mt-1" style={{ color: chosenHere ? "var(--red)" : "var(--tan-3)" }}>
                scores {(score * 100).toFixed(0)}% here ·{" "}
                {chosenHere ? "⚠ already CHOSEN here — a conflict" : decidedOther ? "another predecessor chosen" : "undecided"}
              </p>
              <pre className="mt-1 max-h-28 overflow-auto text-[11px] whitespace-pre-wrap break-words mono" style={{ color: "var(--tan-2)" }}>
                {(subj?.content || "(no prose)").slice(0, 400)}
              </pre>
              <button onClick={() => onOpen(c.key)} className="mt-1 text-[11px] px-2 py-0.5 rounded"
                style={{ background: "var(--accent)", color: "var(--bg)" }}>curate this doc →</button>
            </article>
          );
        })}
        {others.length === 0 && <p className="text-[12px]" style={{ color: "var(--tan-3)" }}>No other document lists this candidate.</p>}
      </div>
    </aside>
  );
}
