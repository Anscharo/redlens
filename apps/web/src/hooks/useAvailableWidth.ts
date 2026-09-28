import { useLayoutEffect, useState } from "react";

/** Pixel width of the docked chat column, or 0 when it is not pushing the page.
 *  The shell's padding-right is that column (chat.css), so the used value
 *  already resolves the undragged clamp() to pixels. */
export function readChatColumn(): number {
  if (typeof document === "undefined") return 0;
  if (!document.body.classList.contains("rlc-anchored")) return 0;
  const shell = document.querySelector(".app-shell");
  if (!shell) return 0;
  const pad = parseFloat(getComputedStyle(shell).paddingRight);
  return Number.isFinite(pad) ? Math.round(pad) : 0;
}

function viewportIsNarrow(maxWidth: number): boolean {
  if (typeof window.matchMedia === "function") {
    return window.matchMedia(`(max-width: ${maxWidth - 1}px)`).matches;
  }
  return window.innerWidth < maxWidth;
}

/** True when the layout should use its narrow treatment. With the chat docked,
 *  the breakpoint is applied to the space beside the chat, so a wide column
 *  collapses sidebars on a window that would otherwise still look wide. */
export function useIsNarrow(maxWidth: number): boolean {
  const [chat, setChat] = useState(readChatColumn);
  const [mqNarrow, setMqNarrow] = useState(() => viewportIsNarrow(maxWidth));

  useLayoutEffect(() => {
    const mq =
      typeof window.matchMedia === "function"
        ? window.matchMedia(`(max-width: ${maxWidth - 1}px)`)
        : null;
    const sync = () => {
      setChat(readChatColumn());
      if (mq) setMqNarrow(mq.matches);
    };
    const onMq = (e: MediaQueryListEvent) => {
      setMqNarrow(e.matches);
      setChat(readChatColumn());
    };
    mq?.addEventListener("change", onMq);
    const shell = document.querySelector(".app-shell");
    const ro =
      shell && typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
    ro?.observe(shell as Element);
    // The docked width is an inline custom property, and docking toggles a body
    // class. Either can change the shell's padding without a window resize.
    const mo = typeof MutationObserver !== "undefined" ? new MutationObserver(sync) : null;
    mo?.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    mo?.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("resize", sync);
    sync();
    return () => {
      mq?.removeEventListener("change", onMq);
      ro?.disconnect();
      mo?.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [maxWidth]);

  if (chat > 0) return window.innerWidth - chat < maxWidth;
  return mqNarrow;
}
