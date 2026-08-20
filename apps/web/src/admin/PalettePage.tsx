import { useMemo, useState } from "react";
import { ColorPickerModal } from "./ColorPickerModal";
import { ContrastAudit } from "./ContrastAudit";
import { PalettePreview } from "./PalettePreview";
import { SwatchGrid } from "./SwatchGrid";
import {
  GROUP_LABEL,
  GROUP_ORDER,
  PALETTE_TOKENS,
  TOKEN_BY_NAME,
  type PaletteGroup,
} from "./palette-tokens";
import { useColorOverrides } from "./useColorOverrides";

const SEMANTIC_GROUPS: readonly PaletteGroup[] = GROUP_ORDER.filter((g) => g !== "depth");

export function PalettePage() {
  const { draft, isDirty, hasSaved, setDraftValue, apply, reset, copySnippet, effectiveValue } =
    useColorOverrides();
  const [editing, setEditing] = useState<string | null>(null);
  const [copyFlash, setCopyFlash] = useState(false);

  const tokensByGroup = useMemo(() => {
    const m = new Map<PaletteGroup, typeof PALETTE_TOKENS>();
    for (const t of PALETTE_TOKENS) {
      const list = (m.get(t.group) ?? []) as typeof PALETTE_TOKENS;
      m.set(t.group, [...list, t]);
    }
    return m;
  }, []);

  const editingToken = editing ? TOKEN_BY_NAME.get(editing) : null;

  async function handleCopy() {
    await copySnippet();
    setCopyFlash(true);
    setTimeout(() => setCopyFlash(false), 1500);
  }

  const hasDraft = Object.keys(draft).length > 0;

  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "24px 32px",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <p className="mono" style={{ fontSize: 11, color: "var(--tan-3)", marginBottom: 4 }}>
          admin
        </p>
        <h1 style={{ fontSize: 24, fontWeight: 600, color: "var(--tan)", margin: "0 0 4px" }}>
          Palette
        </h1>
        <p style={{ fontSize: 13, color: "var(--tan-3)", margin: "0 0 20px", maxWidth: 600 }}>
          Click a swatch to edit. Apply persists the override in this browser. Copy as CSS gives
          you a snippet to paste into <span className="mono">src/index.css</span> for everyone.
        </p>

        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 24,
            paddingBottom: 16,
            borderBottom: "1px solid var(--border)",
            alignItems: "center",
          }}
        >
          <button
            onClick={apply}
            disabled={!isDirty}
            className="mono"
            style={{
              fontSize: 11,
              padding: "6px 14px",
              background: isDirty ? "var(--accent)" : "var(--surface)",
              color: isDirty ? "var(--bg)" : "var(--tan-3)",
              border: `1px solid ${isDirty ? "var(--accent)" : "var(--border)"}`,
              borderRadius: 4,
              cursor: isDirty ? "pointer" : "not-allowed",
              fontWeight: 600,
            }}
          >
            apply
          </button>
          <button
            onClick={reset}
            disabled={!hasSaved && !hasDraft}
            className="mono"
            style={{
              fontSize: 11,
              padding: "6px 14px",
              background: "var(--surface)",
              color: "var(--tan-3)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              cursor: hasSaved || hasDraft ? "pointer" : "not-allowed",
            }}
          >
            reset
          </button>
          <button
            onClick={handleCopy}
            disabled={!hasDraft}
            className="mono"
            style={{
              fontSize: 11,
              padding: "6px 14px",
              background: "var(--surface)",
              color: "var(--tan-3)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              cursor: hasDraft ? "pointer" : "not-allowed",
            }}
          >
            copy as css
          </button>
          {copyFlash && (
            <span className="mono" style={{ fontSize: 10, color: "var(--accent)" }}>
              copied
            </span>
          )}
          {isDirty && !copyFlash && (
            <span className="mono" style={{ fontSize: 10, color: "var(--tan-3)" }}>
              unsaved changes
            </span>
          )}
        </div>

        {SEMANTIC_GROUPS.map((group) => {
          const tokens = tokensByGroup.get(group);
          if (!tokens || tokens.length === 0) return null;
          return (
            <section key={group} style={{ marginBottom: 28 }}>
              <h2
                className="mono"
                style={{
                  fontSize: 11,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "var(--tan-2)",
                  margin: "0 0 10px",
                }}
              >
                {GROUP_LABEL[group]}
              </h2>
              <SwatchGrid
                tokens={tokens}
                draft={draft}
                effectiveValue={effectiveValue}
                onSwatchClick={setEditing}
              />
            </section>
          );
        })}

        <hr
          style={{
            border: "none",
            borderTop: "1px solid var(--border)",
            margin: "32px 0 24px",
          }}
        />

        <section>
          <h2
            className="mono"
            style={{
              fontSize: 11,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--tan-2)",
              margin: "0 0 4px",
            }}
          >
            {GROUP_LABEL.depth}
          </h2>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, margin: "0 0 10px" }}>
            <p style={{ fontSize: 12, color: "var(--tan-3)", margin: 0 }}>
              17 colors used by the doc-tree depth coloring. Editable, but keep the gradient sane.
            </p>
            <button
              className="mono"
              onClick={() => {
                for (let i = 6; i <= 17; i++) {
                  setDraftValue(`depth-${i}`, effectiveValue(`depth-${((i - 1) % 5) + 1}`));
                }
              }}
              style={{ fontSize: 11, padding: "3px 10px", background: "var(--surface)", color: "var(--tan-3)", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer", whiteSpace: "nowrap" }}
            >
              copy pattern
            </button>
          </div>
          <SwatchGrid
            tokens={tokensByGroup.get("depth") ?? []}
            draft={draft}
            effectiveValue={effectiveValue}
            onSwatchClick={setEditing}
          />
        </section>

        <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "32px 0 24px" }} />
        <ContrastAudit effectiveValue={effectiveValue} />

        <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "32px 0 24px" }} />
        <PalettePreview effectiveValue={effectiveValue} />
      </div>

      {editingToken && (
        <ColorPickerModal
          token={editingToken}
          initialValue={effectiveValue(editingToken.name)}
          onCancel={() => setEditing(null)}
          onConfirm={(value) => {
            setDraftValue(editingToken.name, value);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
