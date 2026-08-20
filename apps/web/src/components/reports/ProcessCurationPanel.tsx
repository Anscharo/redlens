import { useState } from "react";
import type { LocalIgnore } from "../../lib/curationStore";

const REASONS = [
  "schema template",
  "category container",
  "role definition",
  "requirement spec",
  "other",
] as const;

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
  const [reason, setReason] = useState<string>("schema template");
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
    setReason("schema template");
  };

  return (
    <div className="rounded p-3 bg-[var(--surface)] text-xs">
      <p className="mono text-tan-3 uppercase tracking-wider text-[10px] mb-2">
        curation
      </p>
      {editing && (
        <div className="mb-3 space-y-2">
          <label className="block">
            <span className="text-tan-3 block mb-1">Reason</span>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full bg-[var(--bg)] text-tan border border-[var(--border)] rounded px-2 py-1"
            >
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          {reason === "other" && (
            <input
              autoFocus
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="describe…"
              className="w-full bg-[var(--bg)] text-tan border border-[var(--border)] rounded px-2 py-1"
            />
          )}
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
