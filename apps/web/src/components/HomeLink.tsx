import { Link } from "./Link";

/** The house icon at the left of the header: a plain link home. */
export function HomeLink() {
  return (
    <Link
      to="/"
      className="order-1 shrink-0 flex items-center justify-center w-7 h-7"
      title="Home"
      aria-label="Home"
      style={{ color: "var(--accent)" }}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M3 10.5 12 3l9 7.5" />
        <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
        <path d="M9.5 21v-6h5v6" />
      </svg>
    </Link>
  );
}
