import { useEffect, useState } from "react";

/** Autoplay dwell per month. */
export const PLAY_MS = 1000;

/** Is the key press typed into a field, where the arrows mean the caret? */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return Boolean(el.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']"));
}

/** Steps `month` through `months` (PLAY_MS each, looping) while playing,
 *  and one month at a time on ← / → (no wrap; typing in a field or holding
 *  a modifier leaves the arrows alone). Opt-in: a page opens paused on its
 *  latest month (or ?msc); selecting a month by hand, or an arrow key,
 *  pauses it again (the page calls `pause`). The overview and a Prime's
 *  settlement page share this so their play buttons and keys behave the
 *  same. `setMsc` is the page's ?msc setter — null for the latest month. */
export function useMonthAutoplay(
  months: readonly string[],
  month: string | null,
  latest: string | null,
  setMsc: (m: string | null) => void,
): { playing: boolean; toggle: () => void; pause: () => void } {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing || months.length < 2 || !month) return;
    const id = setInterval(() => {
      const next = months[(months.indexOf(month) + 1) % months.length];
      setMsc(next === latest ? null : next);
    }, PLAY_MS);
    return () => clearInterval(id);
  }, [playing, months, month, latest, setMsc]);
  useEffect(() => {
    if (months.length < 2 || !month) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || typing(e.target)) return;
      const dir = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
      if (!dir) return;
      const i = months.indexOf(month) + dir;
      if (i < 0 || i >= months.length) return;
      e.preventDefault();
      setPlaying(false);
      setMsc(months[i] === latest ? null : months[i]);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [months, month, latest, setMsc]);
  return { playing, toggle: () => setPlaying((p) => !p), pause: () => setPlaying(false) };
}
