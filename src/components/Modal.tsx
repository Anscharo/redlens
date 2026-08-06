import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  label: string;
  onClose: () => void;
  width?: number;
  children: React.ReactNode;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Shared shell for hand-rolled portal modals: portal + backdrop, Esc to
// close, initial focus, and focus restore on close.
//
// Deliberately NOT a real focus trap (Tab doesn't loop within the modal) —
// that's 40+ lines and needs its own tests; deferred until it's needed.
export function Modal({ label, onClose, width, children }: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Initial focus + focus restore. Runs once on mount so it doesn't refire
  // (and re-capture "previously focused") if onClose's identity changes.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const card = cardRef.current;
    // Skip if a child already focused itself (e.g. via autoFocus) — don't steal it.
    if (card && !card.contains(document.activeElement)) {
      const target =
        card.querySelector<HTMLElement>("[autofocus]") ??
        card.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
        card;
      target.focus();
    }

    return () => {
      if (previouslyFocused && document.body.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
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
        ref={cardRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 20,
          width: width ?? 320,
          maxWidth: "calc(100vw - 32px)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {children}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
