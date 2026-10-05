import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { glide } from "../../lib/animatedScroll";
import { reducedMotion } from "./motion";

// Slack for sub-pixel layout and momentum landing ONLY. Deliberately tiny:
// "the reader scrolled at all" IS the detach signal, so a 20px nudge up to
// re-read a line must not be swallowed as still-at-bottom and then yanked
// back down by the next token. (Same reasoning as animatedScroll's 0.5px.)
const BOTTOM_SLACK_PX = 4;

/** Split out as pure geometry because jsdom has no layout — this is the part
 *  worth testing, and it cannot be tested through the DOM. */
export function isNearBottom(m: { scrollTop: number; scrollHeight: number; clientHeight: number }): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight <= BOTTOM_SLACK_PX;
}

// The follow state. Held in a ref, not state: scroll fires at ~60Hz and
// stickiness must not re-render.
interface FollowState {
  // Following the bottom. Starts true so a hydrated thread lands at the bottom.
  stuck: boolean;
  // Content height at the last commit — the pill must mean "there is new text
  // down there", and plenty of message updates (a verify badge landing, a
  // status-line tick) change the array without adding any. 0 means no
  // committed bottom yet (mount, conversation switch, or stick()).
  lastHeight: number;
  // Set by showFrom(): the reader was placed at the TOP of a just-revealed
  // answer. While it holds, the follow effect neither moves them (the turn's
  // trailing chrome — sources cluster, verify badge — would otherwise pull a
  // short answer's first lines off the top) nor raises the pill (that growth
  // is below them by design, not "new messages"). Cleared by a real scroll,
  // stick(), or a reset.
  aligned: boolean;
  // The scrollTop showFrom() wrote: its own scroll event must not count as the
  // reader moving.
  alignedTop: number;
}

type SetPending = (pending: boolean) => void;

function toBottom(el: HTMLElement | null, animate: boolean) {
  if (!el) return;
  const target = el.scrollHeight - el.clientHeight;
  if (animate && !reducedMotion()) glide(el, target);
  else el.scrollTop = target;
}

// Follow again from the next content to land, with no committed bottom.
function rearm(s: FollowState) {
  s.stuck = true;
  s.aligned = false;
  s.lastHeight = 0;
}

// Re-attaching is position-based: re-reaching the bottom by hand is the same
// "caught up" signal as the pill's click; only the follow effect's detached
// branch ever raises the flag.
function onThreadScroll(el: HTMLElement, s: FollowState, setPending: SetPending) {
  if (Math.abs(el.scrollTop - s.alignedTop) > BOTTOM_SLACK_PX) s.aligned = false;
  const stuck = isNearBottom(el);
  if (stuck === s.stuck) return;
  s.stuck = stuck;
  if (stuck) setPending(false);
}

// Detaching listens to the INPUT, not the resulting scroll event: that event
// is only dispatched at the next frame's render step, and a token committing
// inside that gap would still read `stuck` as true and write the reader's
// scroll straight back to the bottom. At streaming speed that lands as "I
// scrolled up and it snapped back". A thread with nothing to scroll can't hide
// anything below, so input over it must not arm a pill for content that is
// already on screen. A finger travelling DOWN drags the content down, i.e.
// scrolls up. Returns the detach function for the effect's cleanup.
function listenToThread(el: HTMLElement, s: FollowState, setPending: SetPending): () => void {
  const detach = () => {
    if (s.stuck && el.scrollHeight > el.clientHeight + BOTTOM_SLACK_PX) s.stuck = false;
  };
  let touchY = 0;
  const listeners: [string, (e: Event) => void][] = [
    ["wheel", (e) => (e as WheelEvent).deltaY < 0 && detach()],
    ["touchstart", (e) => (touchY = (e as TouchEvent).touches[0]?.clientY ?? 0)],
    ["touchmove", (e) => ((e as TouchEvent).touches[0]?.clientY ?? 0) > touchY + BOTTOM_SLACK_PX && detach()],
    ["scroll", () => onThreadScroll(el, s, setPending)],
  ];
  for (const [type, fn] of listeners) el.addEventListener(type, fn, { passive: true });
  return () => listeners.forEach(([type, fn]) => el.removeEventListener(type, fn));
}

// Layout effect, not effect: a stuck thread must be at the bottom in the same
// frame the new content paints, or the reader sees one frame of the old
// position and then a jump. Scrollbar-thumb drag and keyboard PageUp/ArrowUp
// update scrollTop *before* the `scroll` event; a token in that gap still sees
// `stuck` as true — the same race the input listeners close for wheel/touch.
// Content growth leaves scrollTop unchanged, so a stuck thread still follows.
// While aligned, appending below a top-anchored scroller moves nothing by
// itself, so doing nothing IS the hold.
function followBottom(el: HTMLElement | null, s: FollowState, setPending: SetPending) {
  if (s.stuck && el && s.lastHeight > 0 && el.scrollTop < s.lastHeight - el.clientHeight - BOTTOM_SLACK_PX) {
    s.stuck = false;
  }
  if (s.aligned) {
    // holding at the answer's top
  } else if (s.stuck) toBottom(el, false);
  else if (el && el.scrollHeight > s.lastHeight) setPending(true);
  if (el) s.lastHeight = el.scrollHeight;
}

// Put `target`'s top at the top of the thread and hold there. Only acts while
// still following the bottom: a reader who has scrolled away is never moved.
// This commit's height becomes the baseline: the parent's follow effect runs
// after this (child effects first) and must not read the reveal itself as
// growth to flag. Returns whether it moved anything.
function alignTo(el: HTMLElement | null, target: HTMLElement, s: FollowState): boolean {
  if (!el || !s.stuck) return false;
  const pad = parseFloat(getComputedStyle(el).paddingTop) || 0;
  const top = target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - pad;
  el.scrollTop = Math.max(0, top);
  s.alignedTop = el.scrollTop; // read back: the browser clamps
  s.stuck = isNearBottom(el);
  s.aligned = true;
  s.lastHeight = el.scrollHeight;
  return true;
}

/**
 * Follow-the-bottom for the chat thread, with a hard rule: once the reader has
 * scrolled away from the bottom, NOTHING moves the scroller until they ask.
 *
 * The anti-movement guarantee is the absence of a write, not a clever one. The
 * thread is a plain top-anchored scroller, so appending turns below the
 * viewport does not shift a single pixel of what the reader is looking at —
 * provided we don't set scrollTop. So the detached branch does exactly one
 * thing: raise the "new messages" flag.
 *
 * `follow` is any value whose identity changes when content lands at the
 * bottom (the messages array). `resetKey` changes on a wholesale content swap
 * (conversation switch / new chat) — position-based stickiness alone would
 * strand the reader at the top of a *different* conversation behind a pill.
 */
export function useStickToBottom({ follow, streaming, resetKey }: { follow: unknown; streaming: boolean; resetKey: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  const stateRef = useRef<FollowState>({ stuck: true, lastHeight: 0, aligned: false, alignedTop: 0 });
  const [pending, setPending] = useState(false);
  useEffect(() => (ref.current ? listenToThread(ref.current, stateRef.current, setPending) : undefined), []);
  // Declared BEFORE the follow effect so that in a commit which changes both
  // (hydrate sets conversationId and messages together) re-sticking wins and
  // the switched-to conversation opens at its newest turn.
  useLayoutEffect(() => {
    rearm(stateRef.current);
    setPending(false);
  }, [resetKey]);
  useLayoutEffect(() => followBottom(ref.current, stateRef.current, setPending), [follow]);
  const { stick, showFrom, jumpToBottom } = useThreadActions(ref, stateRef, setPending, streaming);
  return { threadRef: ref, pending, stick, jumpToBottom, showFrom };
}

function useThreadActions(
  ref: RefObject<HTMLDivElement | null>,
  stateRef: RefObject<FollowState>,
  setPending: SetPending,
  streaming: boolean,
) {
  /** Re-follow without moving anything now — for an action whose own content
   *  is about to arrive at the bottom (sending a message). */
  const stick = useCallback(() => {
    rearm(stateRef.current);
    setPending(false);
  }, [stateRef, setPending]);
  /** Put `target`'s top at the top of the thread — for an answer that has
   *  just been revealed, so the reader starts at its first line instead of
   *  being carried to its last — and hold there (see FollowState.aligned). */
  const showFrom = useCallback(
    (target: HTMLElement) => alignTo(ref.current, target, stateRef.current) && setPending(false),
    [ref, stateRef, setPending],
  );
  // Mid-stream, glide's rAF loop would be fighting the per-token catch-up
  // writes (glide only supersedes another glide) — that reads as jitter, so a
  // live thread lands instantly instead.
  const jumpToBottom = useCallback(() => {
    stick();
    toBottom(ref.current, !streaming);
  }, [stick, ref, streaming]);
  return { stick, showFrom, jumpToBottom };
}
