// Inline rename field: Enter and blur submit, Escape cancels.
export function InlineRenameInput({
  value,
  maxLength,
  className = "",
  onChange,
  onSubmit,
  onCancel,
}: {
  value: string;
  maxLength: number;
  className?: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <input
      autoFocus
      className={`text-sm font-medium bg-transparent border-b outline-none flex-1 ${className}`.trimEnd()}
      style={{ color: "var(--tan)", borderColor: "var(--border)" }}
      maxLength={maxLength}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onSubmit}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSubmit();
        if (e.key === "Escape") onCancel();
      }}
    />
  );
}
