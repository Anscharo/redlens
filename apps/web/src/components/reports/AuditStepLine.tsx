// What a PAU values audit row's placing rests on (src/lib/pauStepText.ts),
// linked to the transaction or the executive that shows it.
import type { OnchainStep } from "@/lib/pauPending";
import { stepHref, stepText } from "@/lib/pauStepText";
import { sentence } from "../../lib/rowMark";

export function AuditStepLine({ step }: { step: OnchainStep | null }) {
  if (!step) return null;
  const link = stepHref(step);
  const text = sentence(stepText(step));
  return (
    <div className="mono text-[11px]" style={{ color: "var(--tan-3)" }}>
      {link ? <a href={link} target="_blank" rel="noopener" className="hover:underline">{text}</a> : text}
    </div>
  );
}
