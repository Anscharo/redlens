// Whether motion should be suppressed for chat animations. Two sources, in
// order: the panel's own "reduce motion" preference (usePrefs writes the
// rlc-nomotion body class) and the OS setting. Shared so a new animated
// surface can never honour one and forget the other.
export function reducedMotion(): boolean {
  if (typeof document !== "undefined" && document.body.classList.contains("rlc-nomotion")) return true;
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
