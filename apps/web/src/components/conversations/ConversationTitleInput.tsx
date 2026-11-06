import { MAX_CONVERSATION_TITLE_LEN } from "../../lib/conversationsApi";

// Inline rename field: Enter and blur submit, Escape cancels.
export function ConversationTitleInput({
  value,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <input
      autoFocus
      className="text-sm font-medium bg-transparent border-b outline-none flex-1"
      style={{ color: "var(--tan)", borderColor: "var(--border)" }}
      maxLength={MAX_CONVERSATION_TITLE_LEN}
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
