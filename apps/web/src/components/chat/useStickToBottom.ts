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
    setPending(false);
  }, [resetKey]);

  // Layout effect, not effect: a stuck thread must be at the bottom in the
  // same frame the new content paints, or the reader sees one frame of the
  // old position and then a jump.
  useLayoutEffect(() => {
    const el = ref.current;
    if (stuckRef.current) toBottom(false);
    else if (el && el.scrollHeight > lastHeightRef.current) setPending(true);
    if (el) lastHeightRef.current = el.scrollHeight;
  }, [follow, toBottom]);

  /** Re-follow without moving anything now — for an action whose own content
   *  is about to arrive at the bottom (sending a message). */
  const stick = useCallback(() => {
    stuckRef.current = true;
    setPending(false);
  }, []);

  const jumpToBottom = useCallback(() => {
    stick();
    // Mid-stream, glide's rAF loop would be fighting the per-token catch-up
    // writes above it (glide only supersedes another glide) — that reads as
    // jitter, so a live thread lands instantly instead.
    toBottom(!streaming);
  }, [stick, toBottom, streaming]);

  return { threadRef: ref, pending, stick, jumpToBottom };
}
