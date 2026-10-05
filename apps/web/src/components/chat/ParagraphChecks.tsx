import type { ParagraphCheck } from "./chatTypes";

export interface ParagraphChecksProps {
  checks: ParagraphCheck[] | undefined;
}

// Label per model-audit state that gets its own row — `ok` and `pending`
// never do (see `hasRow` below): a clean or still-checking paragraph has
// nothing to say beyond what the summary line already counts.
const MODEL_ROW_LABEL: Partial<Record<NonNullable<ParagraphCheck["model"]>, string>> = {
  candidate: "possible contradiction, being confirmed",
  failed: "model check unavailable",
};

// A paragraph earns a row only when it has something to report: a
// deterministic finding, or a model state worth surfacing on its own
// (`candidate`/`failed`). `ok` and `pending` render nothing per paragraph —
// the summary line covers "checked" and "still running" for the whole set.
function hasRow(c: ParagraphCheck): boolean {
  return c.findings.length > 0 || c.model === "candidate" || c.model === "failed";
}

// One flagged paragraph: its ¶ number, each deterministic finding, and the
// model state's own label when it has one (no aria-label on that span: it is
// prohibited on a roleless <span> — implicit `generic` role, so Chrome and
// Firefox drop it — and the visible text IS the label). data-state reflects
// the deterministic finding specifically (a candidate/failed row with no
// finding of its own is a plain row, not a stacked "flagged" one — see the
// CSS layout rule). `title` (first 80 chars) only identifies the paragraph on
// hover; its text is already visible right above.
function ParagraphRow({ check: c }: { check: ParagraphCheck }) {
  const modelLabel = c.model ? MODEL_ROW_LABEL[c.model] : undefined;
  return (
    <li data-state={c.findings.length > 0 ? "flagged" : "ok"} data-model={c.model} title={c.text.length > 80 ? `${c.text.slice(0, 80)}…` : c.text}>
      <span className="rlc-para-mark">{`¶${c.index + 1}`}</span>
      {c.findings.map((finding, i) => (
        <span key={i} className="rlc-para-finding">
          {finding}
        </span>
      ))}
      {modelLabel && (
        <span className="rlc-para-model" data-model={c.model}>
          {modelLabel}
        </span>
      )}
    </li>
  );
}

function checksSummary(checks: ParagraphCheck[], flagged: number): string {
  const n = checks.length;
  const pending = checks.some((c) => c.model === "pending");
  const outcome = pending ? ", model check running" : flagged > 0 ? `, ${flagged} flagged` : ", no findings";
  return `${n} paragraph${n === 1 ? "" : "s"} checked${outcome}`;
}

// The incremental per-paragraph audit — rendered under the Synthesizing
// stage row (StageSlot.tsx) once at least one check has landed. A summary
// line always shows (count + outcome); the list below it names only the
// paragraphs that have a deterministic finding or a model state worth
// calling out, so a clean run doesn't restate "checked, no findings" once
// per paragraph.
export function ParagraphChecks({ checks }: ParagraphChecksProps) {
  if (!checks?.length) return null;
  const rows = checks.filter(hasRow);
  return (
    <div className="rlc-para-checks">
      <p className="rlc-para-summary">{checksSummary(checks, rows.length)}</p>
      {rows.length > 0 && (
        <ul aria-label="Paragraph checks">
          {rows.map((c) => (
            <ParagraphRow key={c.index} check={c} />
          ))}
        </ul>
      )}
    </div>
  );
}
