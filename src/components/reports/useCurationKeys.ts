// Keyboard map for the curation page, factored out so HistoryCurateReport stays
// within the file-size budget. Two-axis navigation (plan §10.4 workflow):
//   ↑/↓  previous / next change WITHIN this commit
//   ←/→  previous / next commit
//   Enter confirm the current decision + advance
//   1–N  select candidate N (preview only) · 0  none (created here)
import { useEffect } from "react";

export interface CurationKeyHandlers {
  within: (dir: -1 | 1) => void;
  commit: (dir: -1 | 1) => void;
  confirm: () => void;
  none: () => void;
  select: (n: number) => void;
}

export function useCurationKeys(active: boolean, candidateCount: number, h: CurationKeyHandlers): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowUp") { e.preventDefault(); return h.within(-1); }
      if (e.key === "ArrowDown") { e.preventDefault(); return h.within(1); }
      if (e.key === "ArrowLeft") return h.commit(-1);
      if (e.key === "ArrowRight") return h.commit(1);
      if (e.key === "Enter") return h.confirm();
      if (e.key === "0") return h.none();
      const n = Number(e.key);
      if (n >= 1 && n <= candidateCount) h.select(n);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, candidateCount, h]);
}
