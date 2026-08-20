import { Link } from "wouter";

export function AdminPage() {
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "24px 32px" }}>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        <p className="mono" style={{ fontSize: 11, color: "var(--tan-3)", marginBottom: 4 }}>
          admin
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: "var(--tan)", margin: "0 0 20px" }}>
          Tools
        </h1>

        <Link
          href="/admin/palette"
          className="home-card"
          style={{
            display: "block",
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--tan)", margin: "0 0 6px" }}>
            Palette
          </h2>
          <p style={{ fontSize: 13, color: "var(--tan-3)", margin: 0 }}>
            Tune the dark-theme color tokens. Changes preview live in this browser; export as CSS
            to commit to <span className="mono">src/index.css</span>.
          </p>
        </Link>
      </div>
    </div>
  );
}
