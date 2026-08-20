// Anti-spam honeypot: a field a bot fills in and a real user never sees. The
// server treats a non-empty value as spam and silently discards the
// submission (200, no insert) rather than erroring, so the bot learns nothing.
//
// The styling is the load-bearing part, and is easy to "tidy" into
// uselessness. It must NOT be display:none and must NOT be type="hidden" —
// both are trivially detected, and a bot that spots the trap simply leaves it
// empty. Off-screen absolute positioning keeps it invisible to humans while
// still looking like a real field. tabIndex={-1} keeps keyboard users from
// landing on it, and aria-hidden keeps it out of the accessibility tree.
export function HoneypotField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      name="website"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      tabIndex={-1}
      autoComplete="off"
      aria-hidden="true"
      style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }}
    />
  );
}
