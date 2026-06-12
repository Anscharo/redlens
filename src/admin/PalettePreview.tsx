import { useMemo } from "react";
import { DocNoChiclets } from "../components/DocNoChiclets";
import { chicletColor, segmentDepths } from "../lib/depth";
import { PALETTE_TOKENS } from "./palette-tokens";

const TREE_SAMPLES = [
  { docNo: "A.1",         title: "Scope — Sky Atlas" },
  { docNo: "A.1.2",       title: "Article — Immutable Documents" },
  { docNo: "A.1.2.3",     title: "Section — Definitions" },
  { docNo: "A.3.1.2.4",   title: "Core — Accessibility Scope" },
  { docNo: "A.3.1.2.4.1", title: "Instance" },
] as const;

const ENTITY_SAMPLES = [
  { label: "Agent",            token: "entity-agent" },
  { label: "Facilitator",      token: "entity-facilitator-org" },
  { label: "GovOps",           token: "entity-govops-org" },
  { label: "Aligned Delegate", token: "entity-delegate-org" },
  { label: "Foundation",       token: "entity-foundation" },
] as const;

interface Props {
  effectiveValue: (name: string) => string;
}

export function PalettePreview({ effectiveValue }: Props) {
  const previewVars = useMemo(
    () => Object.fromEntries(PALETTE_TOKENS.map((t) => [`--${t.name}`, effectiveValue(t.name)])) as React.CSSProperties,
    [effectiveValue],
  );

  return (
    <section style={{ marginBottom: 32 }}>
      <h2
        className="mono"
        style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--tan-2)", margin: "0 0 6px" }}
      >
        Live Preview
      </h2>
      <p style={{ fontSize: 12, color: "var(--tan-3)", margin: "0 0 16px" }}>
        Reflects your draft before apply. CSS vars are overridden on this container.
      </p>

      <div style={{ ...previewVars, display: "flex", flexDirection: "column", gap: 20 }}>
        {/* ── Tree rows + DocNoChiclets ── */}
        <div>
          <p className="mono" style={{ fontSize: 10, color: "var(--tan-3)", margin: "0 0 6px" }}>
            doc-tree rows (depth chiclets + bar)
          </p>
          <div style={{ background: "var(--bg-deep)", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
            {TREE_SAMPLES.map(({ docNo, title }, i) => {
              const parts = docNo.split(".");
              const depths = segmentDepths(docNo);
              const treeDepth = parts.length;
              const depthVar = `var(--depth-${Math.min(Math.max(treeDepth, 1), 17)})`;
              const bar = `color-mix(in srgb, ${depthVar} 80%, var(--row-bar-tint))`;
              const titleColor = chicletColor(depths[depths.length - 1] ?? 0);
              return (
                <div
                  key={docNo}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "5px 12px 5px 0",
                    paddingLeft: 4 + (treeDepth - 1) * 10,
                    borderTop: i > 0 ? "1px solid var(--border)" : "none",
                    boxShadow: `inset 2px 0 0 ${bar}`,
                    background: i === 2 ? "var(--atlas-row-selected)" : "transparent",
                  }}
                >
                  <DocNoChiclets parts={parts} depths={depths} />
                  <span style={{ fontSize: 13, color: titleColor, fontWeight: 600 }}>{title}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Text hierarchy ── */}
        <div>
          <p className="mono" style={{ fontSize: 10, color: "var(--tan-3)", margin: "0 0 6px" }}>
            text hierarchy + interactive
          </p>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "baseline", background: "var(--bg)", padding: "10px 12px", borderRadius: 4 }}>
            <span style={{ color: "var(--tan)", fontSize: 14 }}>Primary</span>
            <span style={{ color: "var(--tan-2)", fontSize: 13 }}>Secondary</span>
            <span style={{ color: "var(--tan-3)", fontSize: 12 }}>Tertiary</span>
            <span style={{ color: "var(--gray)", fontSize: 12 }}>Muted</span>
            <span style={{ color: "var(--accent)", fontSize: 13 }}>Accent link</span>
            <span style={{ color: "var(--error-text)", fontSize: 12 }} className="mono">error text</span>
            <mark style={{ background: "var(--red-dim)", color: "var(--tan)", borderRadius: 2, padding: "0 2px", fontSize: 13 }}>
              highlighted term
            </mark>
          </div>
        </div>

        {/* ── Entity labels ── */}
        <div>
          <p className="mono" style={{ fontSize: 10, color: "var(--tan-3)", margin: "0 0 6px" }}>
            entity type labels
          </p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {ENTITY_SAMPLES.map(({ label, token }) => (
              <span
                key={token}
                className="mono"
                style={{ fontSize: 11, padding: "2px 8px", borderRadius: 3, border: `1px solid var(--${token})`, color: `var(--${token})` }}
              >
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* ── StatusPill + terminal ── */}
        <div>
          <p className="mono" style={{ fontSize: 10, color: "var(--tan-3)", margin: "0 0 6px" }}>
            status pills (on --tan background)
          </p>
          <div style={{ display: "flex", gap: 0, alignItems: "center", background: "var(--tan)", padding: "0 8px", borderRadius: 3, width: "fit-content" }}>
            <span className="mono" style={{ fontSize: 10, lineHeight: "24px", color: "var(--magenta)", fontWeight: 600, paddingRight: 12 }}>
              update available
            </span>
            <span className="mono" style={{ fontSize: 10, lineHeight: "24px", color: "var(--red)", fontWeight: 600 }}>
              no network
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
