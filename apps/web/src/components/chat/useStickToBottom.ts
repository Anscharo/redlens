import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { glide } from "../../lib/animatedScroll";
import { reducedMotion } from "./motion";

// Slack for sub-pixel layout and momentum landing only: any scroll is the detach
// signal, so a 20px nudge up to re-read a line must not be yanked back down.
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
  // Content height at the last commit: many message updates add no text, and
  // the pill must mean new text. 0 means no committed bottom yet.
  lastHeight: number;
  // Set by showFrom(): while it holds, trailing chrome growing below a revealed
  // answer neither moves the reader nor raises the pill. Cleared by a real
  // scroll, stick(), or a reset.
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

// Detaching listens to the INPUT, not the scroll event: that fires a frame
// later, and a token committing in the gap would snap the reader back down.
// A thread with nothing to scroll must not arm a pill. A finger moving DOWN scrolls up.
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

// Layout effect so a stuck thread reaches the bottom in the frame content
// paints. Thumb drag and PageUp move scrollTop before `scroll` fires, so a
// moved scrollTop detaches here (growth leaves it unchanged). While aligned,
// doing nothing IS the hold.
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

// Only acts while following: a reader who has scrolled away is never moved.
// This commit's height becomes the baseline so the parent's follow effect
// (which runs after child effects) doesn't flag the reveal as growth.
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
  /** Put a just-revealed answer's first line at the top and hold there (see FollowState.aligned). */
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
