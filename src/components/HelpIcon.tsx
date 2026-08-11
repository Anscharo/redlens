// The help (?) mark, shared by the nav bar's help link and the home page's
// "New here?" banner so the two entry points to /features stay visually
// identical. Inherits `currentColor` — the caller sets size and colour.
export function HelpIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M9.4 9.2a2.6 2.6 0 0 1 5 .9c0 1.7-2.4 2.2-2.4 3.4" />
      <path d="M12 17h.01" />
    </svg>
  );
}
