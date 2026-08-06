import { SHORTCUTS } from "../../lib/shortcuts";
import { Link } from "../Link";
import { ROUTES } from "../../lib/routes";

// Compact reference for the modal: just the "primary" shortcuts, plus a link
// to the full search-syntax reference. Shown under the feedback form in every
// modal state, so "?" doubles as the shortcuts cheat sheet.
export function ShortcutsList() {
  const primary = SHORTCUTS.filter((s) => s.primary);
  return (
    <section aria-label="Keyboard shortcuts">
      <h3
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "var(--tan-3)",
          margin: "4px 0 6px",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        Shortcuts
      </h3>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {primary.map((s) => (
          <li
            key={s.description}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, fontSize: 12, color: "var(--tan)" }}
          >
            <span>{s.description}</span>
            <span>
              {s.keys.map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p style={{ margin: "8px 0 0", fontSize: 11 }}>
        <Link to={ROUTES.SEARCH_HINTS} className="mono" style={{ color: "var(--accent)" }}>
          Search syntax reference →
        </Link>
      </p>
    </section>
  );
}
