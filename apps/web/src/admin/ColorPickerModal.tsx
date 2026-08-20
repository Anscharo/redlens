import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Alpha,
  ShadeSlider,
  Wheel,
  hexToHsva,
  hsvaToHex,
  hsvaToRgba,
  rgbaStringToHsva,
  type HsvaColor,
} from "@uiw/react-color";
import type { PaletteToken } from "./palette-tokens";

interface ColorPickerModalProps {
  token: PaletteToken;
  initialValue: string;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}

function parseToHsva(value: string): HsvaColor {
  const v = value.trim();
  try {
    if (v.startsWith("#")) return hexToHsva(v);
    if (v.startsWith("rgba(") || v.startsWith("rgb(")) return rgbaStringToHsva(v);
  } catch {
    /* fall through */
  }
  return { h: 0, s: 0, v: 0, a: 1 };
}

function formatRgba({ r, g, b, a }: { r: number; g: number; b: number; a: number }): string {
  // Match the existing index.css spacing convention: rgba(r, g, b, a)
  const round = (n: number) => Math.round(n);
  // Trim trailing zeros from alpha but keep it readable.
  const alpha = Number(a.toFixed(3));
  return `rgba(${round(r)}, ${round(g)}, ${round(b)}, ${alpha})`;
}

function serialize(hsva: HsvaColor, alphaEnabled: boolean): string {
  if (alphaEnabled) return formatRgba(hsvaToRgba(hsva));
  return hsvaToHex(hsva);
}

const CHECKER_BG: React.CSSProperties = {
  backgroundImage:
    "linear-gradient(45deg, var(--bg-deep) 25%, transparent 25%), linear-gradient(-45deg, var(--bg-deep) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--bg-deep) 75%), linear-gradient(-45deg, transparent 75%, var(--bg-deep) 75%)",
  backgroundSize: "12px 12px",
  backgroundPosition: "0 0, 0 6px, 6px -6px, -6px 0",
  backgroundColor: "var(--surface)",
};

export function ColorPickerModal({ token, initialValue, onCancel, onConfirm }: ColorPickerModalProps) {
  const [hsva, setHsva] = useState<HsvaColor>(() => parseToHsva(initialValue));
  const [textValue, setTextValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  const initialInlineRef = useRef<string>("");
  const didConfirmRef = useRef(false);

  // Snapshot the pre-open inline style so cancel can restore it. Done leaves
  // the live-previewed value in place; the parent will commit it to the draft.
  useEffect(() => {
    initialInlineRef.current = document.documentElement.style.getPropertyValue(`--${token.name}`);
    didConfirmRef.current = false;
    return () => {
      if (didConfirmRef.current) return;
      const original = initialInlineRef.current;
      if (original) document.documentElement.style.setProperty(`--${token.name}`, original);
      else document.documentElement.style.removeProperty(`--${token.name}`);
    };
  }, [token.name]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function setLive(value: string) {
    document.documentElement.style.setProperty(`--${token.name}`, value);
  }

  function updateHsva(next: HsvaColor) {
    setHsva(next);
    const serialized = serialize(next, token.alpha);
    setTextValue(serialized);
    setLive(serialized);
  }

  function commitText(raw: string) {
    setTextValue(raw);
    const v = raw.trim();
    if (!v) return;
    try {
      if (v.startsWith("#")) {
        setHsva(hexToHsva(v));
        setLive(v);
      } else if (v.startsWith("rgba(") || v.startsWith("rgb(")) {
        setHsva(rgbaStringToHsva(v));
        setLive(v);
      }
    } catch {
      /* swallow — keep typing */
    }
  }

  function handleConfirm() {
    didConfirmRef.current = true;
    onConfirm(serialize(hsva, token.alpha));
  }

  const previewValue = serialize(hsva, token.alpha);

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${token.label}`}
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--shadow-strong)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 20,
          width: 320,
          maxWidth: "calc(100vw - 32px)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div>
          <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--tan)", margin: 0 }}>
            {token.label}
          </h2>
          <p className="mono" style={{ fontSize: 10, color: "var(--tan-3)", margin: "2px 0 0" }}>
            --{token.name}
          </p>
        </div>

        <div style={{ display: "flex", justifyContent: "center" }}>
          <Wheel
            color={hsva}
            onChange={(c) => updateHsva({ ...hsva, ...c.hsva })}
            width={220}
            height={220}
          />
        </div>

        <ShadeSlider
          hsva={hsva}
          onChange={(s) => updateHsva({ ...hsva, ...s })}
          style={{ width: "100%" }}
        />

        {token.alpha && (
          <Alpha
            hsva={hsva}
            onChange={(a) => updateHsva({ ...hsva, ...a })}
            style={{ width: "100%" }}
          />
        )}

        <div
          style={{
            ...(token.alpha ? CHECKER_BG : {}),
            height: 32,
            borderRadius: 4,
            border: "1px solid var(--border)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div style={{ position: "absolute", inset: 0, background: previewValue }} />
        </div>

        <input
          ref={inputRef}
          className="mono"
          type="text"
          value={textValue}
          onChange={(e) => commitText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleConfirm();
            }
          }}
          style={{
            background: "var(--bg)",
            color: "var(--tan)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: "6px 8px",
            fontSize: 12,
            outline: "none",
          }}
        />

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onCancel}
            className="mono"
            style={{
              fontSize: 11,
              padding: "6px 12px",
              background: "transparent",
              color: "var(--tan-3)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            cancel
          </button>
          <button
            onClick={handleConfirm}
            className="mono"
            style={{
              fontSize: 11,
              padding: "6px 12px",
              background: "var(--accent)",
              color: "var(--bg)",
              border: "1px solid var(--accent)",
              borderRadius: 4,
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            done
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
