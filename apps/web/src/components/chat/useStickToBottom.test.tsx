// @vitest-environment jsdom
import { useRef, useState } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { isNearBottom, useStickToBottom } from "./useStickToBottom";

const glide = vi.hoisted(() => vi.fn());
vi.mock("../../lib/animatedScroll", () => ({ glide }));

describe("isNearBottom", () => {
  it("is true at the exact bottom", () => {
    expect(isNearBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
  });

  it("tolerates sub-pixel and momentum landing", () => {
    expect(isNearBottom({ scrollTop: 597.5, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
  });

  // The whole point: a reader who nudged up to re-read a line has detached,
  // and must not be dragged back down by the next token.
  it("is false after a small deliberate scroll up", () => {
    expect(isNearBottom({ scrollTop: 580, scrollHeight: 1000, clientHeight: 400 })).toBe(false);
  });

  it("is true for content shorter than the viewport", () => {
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 200, clientHeight: 400 })).toBe(true);
  });
});

// jsdom has no layout: scrollHeight/clientHeight are 0 and scrollTop is inert
// unless we define them. Each harness declares its own geometry so the hook
// sees a real "detached" or "at bottom" reading.
function Harness({ height = 400, contentHeight = 1000 }: { height?: number; contentHeight?: number }) {
  const [turns, setTurns] = useState(["a"]);
  const [streaming, setStreaming] = useState(false);
  const [conv, setConv] = useState("c1");
  const turnsRef = useRef(turns.length);
  turnsRef.current = turns.length;
  const { threadRef, pending, jumpToBottom, stick } = useStickToBottom({
    follow: turns,
    streaming,
    resetKey: conv,
  });
  return (
    <div>
      <div
        data-testid="thread"
        ref={(el) => {
          if (!el || (el as HTMLElement & { _sized?: boolean })._sized) return;
          (el as HTMLElement & { _sized?: boolean })._sized = true;
          Object.defineProperty(el, "clientHeight", { value: height, configurable: true });
          // A getter, not a value: each added turn must make the content
          // taller, or the pill's "is there actually new text below" gate
          // would never see growth.
          Object.defineProperty(el, "scrollHeight", {
            get: () => contentHeight + (turnsRef.current - 1) * 100,
            configurable: true,
          });
          el.scrollTop = contentHeight - height;
          threadRef.current = el;
        }}
      />
      <span data-testid="pending">{String(pending)}</span>
      <button onClick={() => setTurns((t) => [...t, "x"])}>add turn</button>
      <button onClick={() => setTurns((t) => [...t])}>touch turns</button>
      <button onClick={() => setStreaming(true)}>start streaming</button>
      <button onClick={() => setConv("c2")}>switch conversation</button>
      <button onClick={jumpToBottom}>jump</button>
      <button onClick={stick}>stick</button>
    </div>
  );
}

function scrollUpBy(px: number) {
  const el = screen.getByTestId("thread");
  fireEvent.scroll(el, { target: { scrollTop: el.scrollTop - px } });
}

describe("useStickToBottom", () => {
  beforeEach(() => {
    document.body.classList.remove("rlc-nomotion");
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("follows new content while the reader is at the bottom", () => {
    render(<Harness />);
    const el = screen.getByTestId("thread");
    el.scrollTop = 0; // as if content grew underneath
    act(() => void fireEvent.click(screen.getByText("add turn")));
    expect(el.scrollTop).toBe(700); // the grown content's new bottom
    expect(screen.getByTestId("pending")).toHaveTextContent("false");
  });

  it("leaves scrollTop exactly where the reader put it once detached", () => {
    render(<Harness />);
    const el = screen.getByTestId("thread");
    act(() => scrollUpBy(120));
    expect(el.scrollTop).toBe(480);
    act(() => void fireEvent.click(screen.getByText("add turn")));
    // The load-bearing assertion: not one pixel moved.
    expect(el.scrollTop).toBe(480);
    expect(screen.getByTestId("pending")).toHaveTextContent("true");
  });

  // A verify badge landing, a status-line tick, a `done` flag — plenty of
  // message updates change the array without adding a line of text, and a
  // pill pointing at nothing is worse than no pill.
  it("does not flag a message update that adds no height", () => {
    render(<Harness />);
    act(() => scrollUpBy(120));
    act(() => void fireEvent.click(screen.getByText("touch turns")));
    expect(screen.getByTestId("pending")).toHaveTextContent("false");
    act(() => void fireEvent.click(screen.getByText("add turn")));
    expect(screen.getByTestId("pending")).toHaveTextContent("true");
  });

  it("does not flag new content when the reader never left the bottom", () => {
    render(<Harness />);
    act(() => void fireEvent.click(screen.getByText("add turn")));
    expect(screen.getByTestId("pending")).toHaveTextContent("false");
  });

  it("clears the flag and re-follows when the reader scrolls back down by hand", () => {
    render(<Harness />);
    const el = screen.getByTestId("thread");
    act(() => scrollUpBy(120));
    act(() => void fireEvent.click(screen.getByText("add turn")));
    expect(screen.getByTestId("pending")).toHaveTextContent("true");
    act(() => void fireEvent.scroll(el, { target: { scrollTop: 700 } }));
    expect(screen.getByTestId("pending")).toHaveTextContent("false");
    el.scrollTop = 0;
    act(() => void fireEvent.click(screen.getByText("add turn")));
    expect(el.scrollTop).toBe(800);
  });

  it("glides to the bottom on jump when the thread is idle", () => {
    render(<Harness />);
    act(() => scrollUpBy(120));
    act(() => void fireEvent.click(screen.getByText("add turn")));
    act(() => void fireEvent.click(screen.getByText("jump")));
    expect(glide).toHaveBeenCalledWith(screen.getByTestId("thread"), 700);
    expect(screen.getByTestId("pending")).toHaveTextContent("false");
  });

  // A glide would be writing scrollTop for 220ms while the per-token catch-up
  // writes the bottom every few ms — the two fight and it reads as jitter.
  it("jumps instantly instead of gliding while a turn is still streaming", () => {
    render(<Harness />);
    act(() => void fireEvent.click(screen.getByText("start streaming")));
    act(() => scrollUpBy(120));
    act(() => void fireEvent.click(screen.getByText("jump")));
    expect(glide).not.toHaveBeenCalled();
    expect(screen.getByTestId("thread").scrollTop).toBe(600);
  });

  it("jumps instantly under reduced motion", () => {
    document.body.classList.add("rlc-nomotion");
    render(<Harness />);
    act(() => scrollUpBy(120));
    act(() => void fireEvent.click(screen.getByText("jump")));
    expect(glide).not.toHaveBeenCalled();
    expect(screen.getByTestId("thread").scrollTop).toBe(600);
  });

  // Position-based stickiness alone would strand the reader at the top of a
  // different conversation behind a "new messages" pill.
  it("re-follows on a conversation switch", () => {
    render(<Harness />);
    const el = screen.getByTestId("thread");
    act(() => scrollUpBy(120));
    act(() => void fireEvent.click(screen.getByText("add turn")));
    expect(screen.getByTestId("pending")).toHaveTextContent("true");
    el.scrollTop = 0;
    act(() => void fireEvent.click(screen.getByText("switch conversation")));
    expect(screen.getByTestId("pending")).toHaveTextContent("false");
    act(() => void fireEvent.click(screen.getByText("add turn")));
    expect(el.scrollTop).toBe(800); // three turns tall now
  });

  it("re-follows without moving anything when stick() is called", () => {
    render(<Harness />);
    const el = screen.getByTestId("thread");
    act(() => scrollUpBy(120));
    act(() => void fireEvent.click(screen.getByText("stick")));
    expect(el.scrollTop).toBe(480); // stick() alone never scrolls
    act(() => void fireEvent.click(screen.getByText("add turn")));
    expect(el.scrollTop).toBe(700);
  });
});

// The scroll EVENT lands a frame late; at streaming speed a token can commit
// first and write the reader's scroll away before it arrives. These pin the
// intent listeners that close that gap — note the position still reads "at
// bottom" throughout, which is exactly what makes them prove the input path.
describe("useStickToBottom detach intent", () => {
  beforeEach(() => {
    document.body.classList.remove("rlc-nomotion");
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof window.matchMedia;
  });
  afterEach(() => cleanup());

  it("detaches on a wheel-up before any scroll event arrives", () => {
    render(<Harness />);
    const el = screen.getByTestId("thread");
    act(() => void fireEvent.wheel(el, { deltaY: -100 }));
    act(() => void fireEvent.click(screen.getByText("add turn")));
    expect(el.scrollTop).toBe(600); // untouched, though position reads "at bottom"
    expect(screen.getByTestId("pending")).toHaveTextContent("true");
  });

  it("keeps following on a wheel-down", () => {
    render(<Harness />);
    const el = screen.getByTestId("thread");
    act(() => void fireEvent.wheel(el, { deltaY: 100 }));
    act(() => void fireEvent.click(screen.getByText("add turn")));
    expect(el.scrollTop).toBe(700);
    expect(screen.getByTestId("pending")).toHaveTextContent("false");
  });

  // A wheel over a thread with nothing hidden below would otherwise arm a
  // pill pointing at text already on screen.
  it("ignores a wheel-up on a thread that does not overflow", () => {
    render(<Harness contentHeight={200} />);
    act(() => void fireEvent.wheel(screen.getByTestId("thread"), { deltaY: -100 }));
    act(() => void fireEvent.click(screen.getByText("add turn")));
    expect(screen.getByTestId("pending")).toHaveTextContent("false");
  });

  it("detaches when a finger drags the content down", () => {
    render(<Harness />);
    const el = screen.getByTestId("thread");
    act(() => void fireEvent.touchStart(el, { touches: [{ clientY: 100 }] }));
    act(() => void fireEvent.touchMove(el, { touches: [{ clientY: 160 }] }));
    act(() => void fireEvent.click(screen.getByText("add turn")));
    expect(el.scrollTop).toBe(600);
    expect(screen.getByTestId("pending")).toHaveTextContent("true");
  });

  it("keeps following when a finger drags the content up", () => {
    render(<Harness />);
    const el = screen.getByTestId("thread");
    act(() => void fireEvent.touchStart(el, { touches: [{ clientY: 160 }] }));
    act(() => void fireEvent.touchMove(el, { touches: [{ clientY: 100 }] }));
    act(() => void fireEvent.click(screen.getByText("add turn")));
    expect(screen.getByTestId("pending")).toHaveTextContent("false");
  });

  // Scrollbar-thumb drag and keyboard PageUp/ArrowUp write scrollTop before
  // the `scroll` event. No wheel/touch, position still reads "at bottom"
  // from stuckRef — the follow effect's geometry check is what detaches.
  it("detaches when scrollTop moved without a wheel or touch event", () => {
    render(<Harness />);
    const el = screen.getByTestId("thread");
    el.scrollTop = 480;
    act(() => void fireEvent.click(screen.getByText("add turn")));
    expect(el.scrollTop).toBe(480);
    expect(screen.getByTestId("pending")).toHaveTextContent("true");
  });
});
