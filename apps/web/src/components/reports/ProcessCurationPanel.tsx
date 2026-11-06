import { useState } from "react";
import type { LocalIgnore } from "../../lib/curationStore";
import { DEFAULT_REASON, ProcessReasonFields } from "./ProcessReasonFields";

const PILL =
  "px-2 py-1 rounded bg-[var(--hover)] text-tan text-xs hover:bg-[color-mix(in_srgb,var(--accent)_25%,var(--hover))] disabled:opacity-50";

export function ProcessCurationPanel({
  uuid,
  existing,
  onMark,
  onUnmark,
}: {
  uuid: string;
  existing: LocalIgnore | undefined;
  onMark: (uuid: string, reason: string) => void;
  onUnmark: (uuid: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState<string>(DEFAULT_REASON);
  const [custom, setCustom] = useState("");

  if (existing) {
    return (
      <div className="rounded p-3 bg-[var(--surface)] text-xs">
        <p className="mono text-tan-3 uppercase tracking-wider text-[10px] mb-2">
          curation
        </p>
        <p className="text-tan mb-1">Marked as NonProcess</p>
        <p className="text-tan-3 mb-3 italic">{existing.reason}</p>
        <button onClick={() => onUnmark(uuid)} className="text-accent hover:underline">
          Unmark
        </button>
      </div>
    );
  }

  const finalReason = reason === "other" ? custom.trim() : reason;
  const canConfirm = editing && !!finalReason;

  const reset = () => {
    setEditing(false);
    setCustom("");
    setReason(DEFAULT_REASON);
  };

  return (
    <div className="rounded p-3 bg-[var(--surface)] text-xs">
      <p className="mono text-tan-3 uppercase tracking-wider text-[10px] mb-2">
        curation
      </p>
      {editing && (
        <div className="mb-3 space-y-2">
          <ProcessReasonFields
            reason={reason}
            onReason={setReason}
            custom={custom}
            onCustom={setCustom}
          />
        </div>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => {
            if (!editing) {
              setEditing(true);
              return;
            }
            if (!canConfirm) return;
            onMark(uuid, finalReason);
            reset();
          }}
          disabled={editing && !canConfirm}
          className={PILL}
        >
          {editing ? "Confirm" : "Mark as NonProcess"}
        </button>
        {editing && (
          <button onClick={reset} className="px-2 py-1 text-tan-3 hover:text-tan text-xs">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
