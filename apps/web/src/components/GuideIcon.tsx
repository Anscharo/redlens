// The open-book mark for the /features guide, shared by the nav bar's guide
// link and the home page's "New here?" banner so the two entry points stay
// visually identical. Inherits `currentColor` — the caller sets size and colour.
//
// Deliberately NOT a "?": the nav's feedback button is already a "?" (and owns
// the "?" keypress — see feedback/FeedbackButton.tsx). Two question marks in
// one bar meaning different things is worse than no icon at all.
export function GuideIcon({ size = 20 }: { size?: number }) {
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
      <path d="M12 7c-1.6-1.6-3.9-2.2-8-2.2v12.6c4.1 0 6.4.6 8 2.2 1.6-1.6 3.9-2.2 8-2.2V4.8c-4.1 0-6.4.6-8 2.2z" />
      <path d="M12 7v12.6" />
    </svg>
  );
}
