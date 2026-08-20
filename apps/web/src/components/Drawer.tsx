import { useState, useEffect } from "react";
import { HEADER_OFFSET } from "../lib/layout";
import { useResizeDrag } from "../hooks/useResizeDrag";

function useIsNarrow(maxWidth: number) {
  const [narrow, setNarrow] = useState(() => window.innerWidth < maxWidth);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${maxWidth - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener("change", handler);
    setNarrow(mq.matches);
    return () => mq.removeEventListener("change", handler);
  }, [maxWidth]);
  return narrow;
}

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  breakpoint?: number;
  defaultWidth?: number;
  /** Desktop layout. "static" keeps the sidebar in flex flow (fixed-shell
   *  routes). "sticky" pins it to the viewport below the header so it stays
   *  visible while the window scrolls (window-scroll routes). */
  desktopMode?: "static" | "sticky";
  resizable?: boolean;
  minWidth?: number;
  maxWidth?: number;
  storageKey?: string;
  children: React.ReactNode;
}

export function Drawer({
  open,
  onClose,
  breakpoint = 1050,
  defaultWidth = 220,
  desktopMode = "static",
  resizable = false,
  minWidth = 180,
  maxWidth = 600,
  storageKey,
  children,
}: DrawerProps) {
  const isDrawer = useIsNarrow(breakpoint);

  const [currentWidth, setCurrentWidth] = useState(() => {
    if (!resizable || !storageKey) return defaultWidth;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n) && n >= minWidth && n <= maxWidth) return n;
      }
    } catch {}
    return defaultWidth;
  });

  const effectiveWidth = isDrawer || !resizable ? defaultWidth : currentWidth;

  const startResize = useResizeDrag(currentWidth, setCurrentWidth, {
    min: minWidth,
    max: maxWidth,
    storageKey,
  });

  const showHandle = resizable && !isDrawer;

  const desktopStyle: React.CSSProperties =
    desktopMode === "sticky"
      ? {
          position: "sticky",
          top: HEADER_OFFSET,
          alignSelf: "flex-start",
          height: `calc(100vh - ${HEADER_OFFSET}px)`,
          width: effectiveWidth,
          flexShrink: 0,
          background: "var(--bg)",
        }
      : {
          width: effectiveWidth,
          flexShrink: 0,
          background: "var(--bg)",
          position: "relative",
        };

  return (
    <>
      {isDrawer && open && <div className="fixed inset-0 z-20 bg-black/40" onClick={onClose} />}
      <div
        style={
          isDrawer
            ? {
                position: "fixed",
                top: 0,
                bottom: 0,
                left: 0,
                zIndex: 30,
                width: effectiveWidth,
                background: "var(--bg)",
                transform: open ? "translateX(0)" : "translateX(-100%)",
                transition: "transform 200ms",
              }
            : desktopStyle
        }
      >
        {children}
        {showHandle && (
          <div
            onMouseDown={startResize}
            title="Drag to resize"
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              right: -3,
              width: 6,
              cursor: "col-resize",
              zIndex: 10,
            }}
          />
        )}
      </div>
    </>
  );
}

export function DrawerToggle({
  label,
  onClick,
  breakpoint = 1050,
}: {
  label: string;
  onClick?: () => void;
  breakpoint?: number;
}) {
  const isDrawer = useIsNarrow(breakpoint);
  if (!isDrawer) return null;
  return (
    <div className="shrink-0 px-1 py-1">
      <button
        onClick={onClick}
        className="mono text-xs px-1 py-1 rounded border"
        style={{ color: "var(--tan-3)", borderColor: "var(--hover)" }}
      >
        ☰ {label}
      </button>
    </div>
  );
}
