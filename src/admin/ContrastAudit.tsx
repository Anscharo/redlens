import { AUDIT_PAIRS, contrastRatio, rateContrast, type ContrastLevel } from "./contrast";

const LEVEL_COLOR: Record<ContrastLevel, string> = {
  AAA: "var(--depth-3)",
  AA: "var(--terminal-green)",
  "AA Large": "var(--depth-2)",
  Fail: "var(--error-text)",
};

interface Props {
  effectiveValue: (name: string) => string;
}

export function ContrastAudit({ effectiveValue }: Props) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2
        className="mono"
        style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--tan-2)", margin: "0 0 6px" }}
      >
        Contrast Audit
      </h2>
      <p style={{ fontSize: 12, color: "var(--tan-3)", margin: "0 0 12px" }}>
        WCAG 2.1 via <span className="mono">wcag-contrast</span>. AA = 4.5:1 (body text). AA Large = 3:1
        (large/bold/decorative). Live against your draft.
      </p>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {AUDIT_PAIRS.map(({ fg, bg, label }) => {
          const fgVal = effectiveValue(fg);
          const bgVal = effectiveValue(bg);
          const ratio = contrastRatio(fgVal, bgVal);
          const level = ratio != null ? rateContrast(ratio) : null;
          return (
            <div
              key={`${fg}/${bg}`}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 26px 48px 72px",
                alignItems: "center",
                gap: 8,
                padding: "4px 0",
                borderTop: "1px solid var(--border)",
              }}
            >
              <span style={{ fontSize: 11, color: "var(--tan-3)" }}>{label}</span>
              <span style={{ display: "flex", gap: 2 }}>
                <span
                  title={fgVal}
                  style={{ width: 11, height: 11, borderRadius: 2, background: fgVal, border: "1px solid var(--border)", display: "inline-block" }}
                />
                <span
                  title={bgVal}
                  style={{ width: 11, height: 11, borderRadius: 2, background: bgVal, border: "1px solid var(--border)", display: "inline-block" }}
                />
              </span>
              <span className="mono" style={{ fontSize: 11, color: "var(--tan)", textAlign: "right" }}>
                {ratio != null ? ratio.toFixed(2) : "—"}
              </span>
              <span
                className="mono"
                style={{ fontSize: 10, fontWeight: 700, textAlign: "right", color: level ? LEVEL_COLOR[level] : "var(--gray)" }}
              >
                {level ?? "—"}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
