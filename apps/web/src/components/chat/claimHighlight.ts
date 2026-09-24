import { glide } from "../../lib/animatedScroll";
import { reducedMotion } from "./motion";

const HEADER_OFFSET = 64;
const FLASH_MS = 1200;

// One in-flight highlight per answer, so a second click doesn't let the first
// timer unwrap the newer mark.
const generation = new WeakMap<HTMLElement, number>();

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Where `claim` sits inside rendered answer text.
 *
 * The stored claim has markdown links removed entirely (link text included),
 * so it is often not a contiguous substring of what the reader sees. Take the
 * longest run of the claim's words that does occur, whitespace-flexible.
 * Ties keep the leftmost run. Fewer than three words and under 12 characters
 * is too small to point at.
 */
export function locateClaim(text: string, claim: string): { start: number; end: number } | null {
  const words = claim.trim().split(/\s+/).filter(Boolean);
  let best: { start: number; end: number; len: number } | null = null;
  for (let i = 0; i < words.length; i++) {
    for (let j = words.length; j > i; j--) {
      const len = j - i;
      if (best && len <= best.len) break;
      const run = words.slice(i, j);
      const chars = run.join(" ").length;
      if (run.length < 3 && chars < 12) continue;
      const match = new RegExp(run.map(escapeRegExp).join("\\s+"), "i").exec(text);
      if (match) best = { start: match.index, end: match.index + match[0].length, len };
    }
  }
  return best ? { start: best.start, end: best.end } : null;
}

function textNodes(root: HTMLElement): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n = walker.nextNode();
  while (n) {
    out.push(n as Text);
    n = walker.nextNode();
  }
  return out;
}

export function clearClaimHighlight(root: HTMLElement) {
  for (const mark of root.querySelectorAll("mark.rlc-claim-flash")) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
}

function wrapRange(root: HTMLElement, start: number, end: number) {
  const nodes = textNodes(root);
  let offset = 0;
  const slices: Text[] = [];
  for (const node of nodes) {
    const nodeStart = offset;
    const nodeEnd = offset + node.data.length;
    offset = nodeEnd;
    if (nodeEnd <= start || nodeStart >= end) continue;
    const localStart = Math.max(0, start - nodeStart);
    const localEnd = Math.min(node.data.length, end - nodeStart);
    let target = node;
    if (localStart > 0) target = target.splitText(localStart);
    const len = localEnd - localStart;
    if (len < target.data.length) target.splitText(len);
    slices.push(target);
  }
  for (const target of slices) {
    const mark = document.createElement("mark");
    mark.className = "rlc-claim-flash";
    target.parentNode?.insertBefore(mark, target);
    mark.appendChild(target);
  }
}

function scrollClaimIntoView(mark: HTMLElement) {
  const scroller = mark.closest(".rlc-thread");
  if (!(scroller instanceof HTMLElement)) {
    try {
      mark.scrollIntoView({ behavior: "instant", block: "nearest" });
    } catch {
      // jsdom leaves scrollIntoView unimplemented.
    }
    return;
  }
  const box = mark.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  if (box.height > 0 && box.top >= view.top + HEADER_OFFSET && box.bottom <= view.bottom) return;
  const target = Math.max(
    0,
    Math.min(
      box.top - view.top + scroller.scrollTop - HEADER_OFFSET,
      scroller.scrollHeight - scroller.clientHeight,
    ),
  );
  if (reducedMotion()) {
    scroller.scrollTop = target;
    return;
  }
  glide(scroller, target);
}

/** Scroll the quoted claim into view inside this answer and flash it. */
export function showClaimInAnswer(answer: HTMLElement, claim: string): boolean {
  const gen = (generation.get(answer) ?? 0) + 1;
  generation.set(answer, gen);
  clearClaimHighlight(answer);
  const located = locateClaim(answer.textContent ?? "", claim);
  if (!located) return false;
  wrapRange(answer, located.start, located.end);
  const mark = answer.querySelector("mark.rlc-claim-flash");
  if (mark instanceof HTMLElement) scrollClaimIntoView(mark);
  window.setTimeout(() => {
    if (generation.get(answer) === gen) clearClaimHighlight(answer);
  }, FLASH_MS + 200);
  return true;
}
