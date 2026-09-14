import { useEffect, useState } from "react";

/** Autoplay dwell per month. */
export const PLAY_MS = 1000;

/** Steps `month` through `months` (PLAY_MS each, looping) while playing.
 *  Opt-in: a page opens paused on its latest month (or ?msc); selecting a
 *  month by hand pauses it again (the page calls `pause`). The overview and
 *  a Prime's settlement page share this so their play buttons behave the
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
  return { playing, toggle: () => setPlaying((p) => !p), pause: () => setPlaying(false) };
}
