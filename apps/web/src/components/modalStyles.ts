import type { CSSProperties } from "react";

// Shared button styles for hand-rolled modal dialogs (see Modal.tsx).
export const btnBase: CSSProperties = { fontSize: 11, padding: "6px 12px", borderRadius: 4, cursor: "pointer" };
export const ghostBtn: CSSProperties = { ...btnBase, background: "transparent", color: "var(--tan-3)", border: "1px solid var(--border)" };
export const primaryBtn: CSSProperties = { ...btnBase, background: "var(--accent)", color: "var(--bg)", border: "1px solid var(--accent)", fontWeight: 600 };
