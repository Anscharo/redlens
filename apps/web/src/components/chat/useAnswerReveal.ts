import { useLayoutEffect, useRef } from "react";

// The reveal is the one moment the answer's height lands all at once, in the
// same commit that hides the live draft in the synthesizing row. This tells
// the thread (via `onAnswerReveal`, with the answer element) so it can show
// the answer from its first line. Transition only (prev-ref): a hydrated
// message mounts with `generated` already true and must open at the bottom
// like any loaded thread. Returns the ref for the answer element.
export function useAnswerReveal(generated: boolean, content: string, onAnswerReveal?: (el: HTMLElement) => void) {
  const answerRef = useRef<HTMLDivElement>(null);
  const prevGeneratedRef = useRef(generated);
  useLayoutEffect(() => {
    const was = prevGeneratedRef.current;
    prevGeneratedRef.current = generated;
    if (generated && !was && content && answerRef.current) onAnswerReveal?.(answerRef.current);
  }, [generated, content, onAnswerReveal]);
  return answerRef;
}
