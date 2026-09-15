import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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
export function useStickToBottom({
  follow,
  streaming,
  resetKey,
}: {
  follow: unknown;
  streaming: boolean;
  resetKey: unknown;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // A ref, not state: scroll fires at ~60Hz and stickiness must not re-render.
  // Starts true so the first render of a hydrated thread lands at the bottom.
  const stuckRef = useRef(true);
  // Content height at the last commit — the pill must mean "there is new text
  // down there", and plenty of message updates (a verify badge landing, a
  // status-line tick) change the array without adding any.
  const lastHeightRef = useRef(0);
  // Set by showFrom(): the reader was placed at the TOP of a just-revealed
  // answer. While it holds, the follow effect neither moves them (the
  // turn's trailing chrome — sources cluster, verify badge — would
  // otherwise pull a short answer's first lines off the top) nor raises the
  // pill (that growth is below them by design, not "new messages"). Cleared
  // by a real scroll, stick(), or a reset.
  const alignedRef = useRef(false);
  // The scrollTop showFrom() wrote: its own scroll event must not count as
  // the reader moving.
  const alignedTopRef = useRef(0);
  const [pending, setPending] = useState(false);

  const toBottom = useCallback((animate: boolean) => {
    const el = ref.current;
    if (!el) return;
    const target = el.scrollHeight - el.clientHeight;
    if (animate && !reducedMotion()) glide(el, target);
    else el.scrollTop = target;
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Detaching listens to the INPUT, not the resulting scroll event: that
    // event is only dispatched at the next frame's render step, and a token
    // committing inside that gap would still read stuckRef as true and write
    // the reader's scroll straight back to the bottom. At streaming speed
    // that lands as "I scrolled up and it snapped back" — the whole bug.
    // Re-attaching stays position-based (below), where no such race exists.
    const detach = () => {
      // A thread with nothing to scroll can't hide anything below, so a wheel
      // over it must not arm a pill for content that is already on screen.
      if (!stuckRef.current || el.scrollHeight <= el.clientHeight + BOTTOM_SLACK_PX) return;
      stuckRef.current = false;
    };
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) detach();
    };
    let touchY = 0;
    const onTouchStart = (e: TouchEvent) => {
      touchY = e.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      // Finger travelling DOWN drags the content down, i.e. scrolls up.
      if ((e.touches[0]?.clientY ?? 0) > touchY + BOTTOM_SLACK_PX) detach();
    };

    const onScroll = () => {
      if (Math.abs(el.scrollTop - alignedTopRef.current) > BOTTOM_SLACK_PX) alignedRef.current = false;
      const stuck = isNearBottom(el);
      if (stuck === stuckRef.current) return;
      stuckRef.current = stuck;
      // Re-reaching the bottom by hand is the same "caught up" signal as the
      // pill's click; only the detached branch below ever raises the flag.
      if (stuck) setPending(false);
    };

    const opts = { passive: true } as const;
    el.addEventListener("wheel", onWheel, opts);
    el.addEventListener("touchstart", onTouchStart, opts);
    el.addEventListener("touchmove", onTouchMove, opts);
    el.addEventListener("scroll", onScroll, opts);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("scroll", onScroll);
    };
  }, []);

  // Declared BEFORE the follow effect so that in a commit which changes both
  // (hydrate sets conversationId and messages together) re-sticking wins and
  // the switched-to conversation opens at its newest turn.
  useLayoutEffect(() => {
    stuckRef.current = true;
    alignedRef.current = false;
    // No committed bottom for the new thread — the follow effect must not
    // treat the previous conversation's height as "the reader scrolled away".
    lastHeightRef.current = 0;
    setPending(false);
  }, [resetKey]);

  // Layout effect, not effect: a stuck thread must be at the bottom in the
  // same frame the new content paints, or the reader sees one frame of the
  // old position and then a jump.
  useLayoutEffect(() => {
    const el = ref.current;
    // Scrollbar-thumb drag and keyboard PageUp/ArrowUp update scrollTop
    // *before* the `scroll` event. A token in that gap still sees stuckRef
    // as true — the same race the wheel/touch listeners close for those
    // inputs. Content growth leaves scrollTop unchanged, so a stuck thread
    // still follows. lastHeightRef === 0 means no committed bottom yet
    // (mount, conversation switch, or stick()) — don't second-guess.
    if (
      stuckRef.current &&
      el &&
      lastHeightRef.current > 0 &&
      el.scrollTop < lastHeightRef.current - el.clientHeight - BOTTOM_SLACK_PX
    ) {
      stuckRef.current = false;
    }
    if (alignedRef.current) {
      // Holding at the answer's top: appending below a top-anchored scroller
      // moves nothing by itself, so doing nothing IS the hold.
    } else if (stuckRef.current) toBottom(false);
    else if (el && el.scrollHeight > lastHeightRef.current) setPending(true);
    if (el) lastHeightRef.current = el.scrollHeight;
  }, [follow, toBottom]);

  /** Re-follow without moving anything now — for an action whose own content
   *  is about to arrive at the bottom (sending a message). */
  const stick = useCallback(() => {
    stuckRef.current = true;
    alignedRef.current = false;
    lastHeightRef.current = 0;
    setPending(false);
  }, []);

  /** Put `target`'s top at the top of the thread — for an answer that has
   *  just been revealed, so the reader starts at its first line instead of
   *  being carried to its last — and hold there (see alignedRef). Only acts
   *  while still following the bottom: a reader who has scrolled away is
   *  never moved (the hook's one rule). */
  const showFrom = useCallback((target: HTMLElement) => {
    const el = ref.current;
    if (!el || !stuckRef.current) return;
    const pad = parseFloat(getComputedStyle(el).paddingTop) || 0;
    const top = target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - pad;
    el.scrollTop = Math.max(0, top);
    alignedTopRef.current = el.scrollTop; // read back: the browser clamps
    stuckRef.current = isNearBottom(el);
    alignedRef.current = true;
    // This commit's height is the new baseline: the parent's follow effect
    // runs after this (child effects first) and must not read the reveal
    // itself as growth to flag.
    lastHeightRef.current = el.scrollHeight;
    setPending(false);
  }, []);

  const jumpToBottom = useCallback(() => {
    stick();
    // Mid-stream, glide's rAF loop would be fighting the per-token catch-up
    // writes above it (glide only supersedes another glide) — that reads as
    // jitter, so a live thread lands instantly instead.
    toBottom(!streaming);
  }, [stick, toBottom, streaming]);

  return { threadRef: ref, pending, stick, jumpToBottom, showFrom };
}
