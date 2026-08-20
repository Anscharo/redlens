import { useEffect, useRef, useState } from "react";

// Total glide time is capped regardless of answer length (brief: "at most
// ~1.5-2s"); chunk size is derived from steps so longer text reveals in
// bigger bites rather than more ticks.
const TICK_MS = 40;
const MAX_MS = 1800;
const MIN_MS = 260;

function reducedMotion(): boolean {
  if (typeof document !== "undefined" && document.body.classList.contains("rlc-nomotion")) return true;
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

// Types out `content` once `done` flips true, but ONLY when content was empty
// right before that transition — a staged-mode reveal. A streaming-mode
// `done` (content already present beforehand, grown by prior `token` events)
// mirrors immediately with no animation. That gate can't be read off the
// current props alone (content is already the final text by the time `done`
// is true) — it's tracked via refs holding the PRIOR render's values.
export function useRevealOnDone(content: string, done: boolean) {
  const [display, setDisplay] = useState(content);
  const [revealing, setRevealing] = useState(false);
  const prevDoneRef = useRef(done);
  const prevContentRef = useRef(content);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
    },
    [],
  );

  useEffect(() => {
    const justFinished = done && !prevDoneRef.current;
    const wasEmpty = prevContentRef.current === "";
    prevDoneRef.current = done;
    prevContentRef.current = content;
    if (!done) return; // display is unused pre-done — skip the extra churn while streaming

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (!justFinished || !wasEmpty || !content || reducedMotion()) {
      setDisplay(content);
      setRevealing(false);
      return;
    }

    setDisplay("");
    setRevealing(true);
    const duration = Math.min(MAX_MS, Math.max(MIN_MS, content.length * 6));
    const steps = Math.max(1, Math.round(duration / TICK_MS));
    const chunk = Math.max(1, Math.ceil(content.length / steps));
    let i = 0;
    timerRef.current = setInterval(() => {
      i += chunk;
      if (i >= content.length) {
        setDisplay(content);
        setRevealing(false);
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
      } else {
        setDisplay(content.slice(0, i));
      }
    }, TICK_MS);
  }, [content, done]);

  return { display, revealing };
}
