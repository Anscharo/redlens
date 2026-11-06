const REASONS = [
  "schema template",
  "category container",
  "role definition",
  "requirement spec",
  "other",
] as const;

export const DEFAULT_REASON: string = REASONS[0];

const FIELD =
  "w-full bg-[var(--bg)] text-tan border border-[var(--border)] rounded px-2 py-1";

// The reason select, plus a free-text input when "other" is chosen.
export function ProcessReasonFields({
  reason,
  onReason,
  custom,
  onCustom,
}: {
  reason: string;
  onReason: (reason: string) => void;
  custom: string;
  onCustom: (custom: string) => void;
}) {
  return (
    <>
      <label className="block">
        <span className="text-tan-3 block mb-1">Reason</span>
        <select value={reason} onChange={(e) => onReason(e.target.value)} className={FIELD}>
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
          onChange={(e) => onCustom(e.target.value)}
          placeholder="describe…"
          className={FIELD}
        />
      )}
    </>
  );
}
