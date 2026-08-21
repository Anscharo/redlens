// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Message } from "./Message";
import type { ChatMsg } from "./useChatStream";

vi.mock("../../lib/docs", () => ({ loadAtlas: () => Promise.resolve({ docs: {} }) }));
vi.mock("../../lib/analytics", () => ({ track: vi.fn() }));

afterEach(cleanup);

function baseMsg(over: Partial<ChatMsg>): ChatMsg {
  return { role: "assistant", content: "", trace: [], rounds: 0, sources: [], done: false, stageLog: [], ...over };
}

describe("Message", () => {
  it("renders a user turn as plain text in a bubble", () => {
    render(
      <Message msg={{ ...baseMsg({}), role: "user", content: "hi there" }} streaming={false} showTrace={false} onAtlas={vi.fn()} />,
    );
    expect(screen.getByText("you")).toBeInTheDocument();
    expect(screen.getByText("hi there")).toBeInTheDocument();
  });

  it("shows a thinking placeholder for a streaming assistant turn with no content yet", () => {
    render(
      <Message
        msg={baseMsg({ content: "", statusLine: "searching…" })}
        streaming
        showTrace={false}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.getByText("searching…")).toBeInTheDocument();
  });

  it("defaults the thinking placeholder text when no statusLine is set", () => {
    render(<Message msg={baseMsg({ content: "" })} streaming showTrace={false} onAtlas={vi.fn()} />);
    expect(screen.getByText("searching the stars…")).toBeInTheDocument();
  });

  it("renders markdown content plus a caret and status line while streaming with content", () => {
    render(
      <Message
        msg={baseMsg({ content: "partial answer", statusLine: "reading…" })}
        streaming
        showTrace={false}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.getByText("partial answer")).toBeInTheDocument();
    expect(screen.getByText("reading…")).toBeInTheDocument();
    expect(document.querySelector(".rlc-caret")).toBeInTheDocument();
  });

  it("shows Sources once done and not streaming, using content-derived citations", () => {
    render(
      <Message
        msg={baseMsg({
          content: "See [Doc](/atlas/11111111-1111-1111-1111-111111111111)",
          done: true,
        })}
        streaming={false}
        showTrace={false}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.getByText("sources · 1")).toBeInTheDocument();
  });

  it("shows the ToolTrace when showTrace is true and there is a trace", () => {
    render(
      <Message
        msg={baseMsg({ trace: [{ name: "atlas_get", args: {}, ok: true, bytes: 10 }], rounds: 1 })}
        streaming={false}
        showTrace
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.getByText("looked up 1 thing over the atlas")).toBeInTheDocument();
  });

  it("hides the ToolTrace when showTrace is false even with a trace present", () => {
    render(
      <Message
        msg={baseMsg({ trace: [{ name: "atlas_get", args: {}, ok: true, bytes: 10 }], rounds: 1 })}
        streaming={false}
        showTrace={false}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.queryByText("looked up 1 thing over the atlas")).toBeNull();
  });

  it("shows a distinct failed-turn notice for a done, empty, failed assistant message", () => {
    render(<Message msg={baseMsg({ content: "", done: true, failed: true })} streaming={false} showTrace={false} onAtlas={vi.fn()} />);
    expect(screen.getByText(/This reply didn.t come through/)).toBeInTheDocument();
    expect(document.querySelector(".rlc-turn-error")).toBeInTheDocument();
  });

  it("does not show the failed-turn notice once real content has arrived, even if failed lingers", () => {
    render(
      <Message msg={baseMsg({ content: "an actual answer", done: true, failed: true })} streaming={false} showTrace={false} onAtlas={vi.fn()} />,
    );
    expect(screen.queryByText(/This reply didn.t come through/)).toBeNull();
    expect(screen.getByText("an actual answer")).toBeInTheDocument();
  });

  it("prefers the thinking placeholder over the failed notice while still streaming", () => {
    render(<Message msg={baseMsg({ content: "", failed: true })} streaming showTrace={false} onAtlas={vi.fn()} />);
    expect(screen.getByText("searching the stars…")).toBeInTheDocument();
    expect(screen.queryByText(/This reply didn.t come through/)).toBeNull();
  });

  it("renders a download button per export and downloads on click", () => {
    const realCreate = URL.createObjectURL;
    const realRevoke = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:mock");
    URL.revokeObjectURL = vi.fn();
    try {
      render(
        <Message
          msg={baseMsg({
            done: true,
            exports: [{ format: "csv", filename: "data.csv", mime: "text/csv;charset=utf-8", content: "a", bytes: 1 }],
          })}
          streaming={false}
          showTrace={false}
          onAtlas={vi.fn()}
        />,
      );
      expect(screen.getByText("files · 1")).toBeInTheDocument();
      const btn = screen.getByRole("button", { name: /data\.csv/ });
      fireEvent.click(btn);
      expect(URL.createObjectURL).toHaveBeenCalled();
    } finally {
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
    }
  });

  it("shows a VerifyBadge when the message carries a verify state", () => {
    render(
      <Message
        msg={baseMsg({
          verify: {
            status: "pass",
            claims: [],
            invalidCitations: [],
            invalidDocNos: [],
            docNoMismatches: [],
            ungroundedQuotes: [],
            ungroundedAddresses: [],
            ungroundedCitationValues: [],
            paramMismatches: [],
            lengthCapped: false,
          },
        })}
        streaming={false}
        showTrace={false}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.getByText("verified against the atlas")).toBeInTheDocument();
  });
});

describe("Message staged-mode stage checklist", () => {
  it("renders the checklist (labels + active detail) while !done, empty content, stageLog non-empty", () => {
    render(
      <Message
        msg={baseMsg({
          delivery: "staged",
          stageLog: [
            { stage: "querying", detail: "Searching the atlas for facilitator rewards…", at: 0 },
          ],
        })}
        streaming
        showTrace={false}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.getByText("Looking for evidence")).toBeInTheDocument();
    expect(screen.getByText("Searching the atlas for facilitator rewards…")).toBeInTheDocument();
    // The old plain thinking placeholder is superseded once a stage row exists.
    expect(screen.queryByText("searching the stars…")).toBeNull();
  });

  it("coalesces to the latest row as active; earlier rows show only their label", () => {
    render(
      <Message
        msg={baseMsg({
          delivery: "staged",
          stageLog: [
            { stage: "querying", detail: "Searching…", at: 0 },
            { stage: "checking", detail: "Auditing 3 claims…", at: 1 },
          ],
        })}
        streaming
        showTrace={false}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.getByText("Looking for evidence")).toBeInTheDocument();
    expect(screen.getByText("Verifying content")).toBeInTheDocument();
    expect(screen.getByText("Auditing 3 claims…")).toBeInTheDocument();
    // Only the active (last) row shows a detail line.
    expect(screen.queryByText("Searching…")).toBeNull();
  });

  it("hides the checklist once content is non-empty, even mid-stream (streaming mode unaffected)", () => {
    const msg = baseMsg({
      delivery: "staged",
      content: "",
      stageLog: [{ stage: "querying", detail: "Searching…", at: 0 }],
    });
    const { rerender } = render(<Message msg={msg} streaming showTrace={false} onAtlas={vi.fn()} />);
    expect(screen.getByText("Looking for evidence")).toBeInTheDocument();

    rerender(<Message msg={{ ...msg, content: "partial token text" }} streaming showTrace={false} onAtlas={vi.fn()} />);
    expect(screen.queryByText("Looking for evidence")).toBeNull();
    expect(screen.getByText("partial token text")).toBeInTheDocument();
    expect(document.querySelector(".rlc-caret")).toBeInTheDocument();
  });

  it("never shows the checklist in explicit streaming mode — the old placeholder keeps the pre-token window", () => {
    render(
      <Message
        msg={baseMsg({ delivery: "streaming", content: "", statusLine: "searching…", stageLog: [{ stage: "querying", detail: "Searching…", at: 0 }] })}
        streaming
        showTrace={false}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.queryByText("Looking for evidence")).toBeNull();
    expect(screen.getByText("searching…")).toBeInTheDocument();
  });

  it("an unstamped delivery falls back to the classic ticker, not the staged checklist", () => {
    // A degraded/older server that never sends `delivery` on meta. Unknown
    // mode must degrade to the historical UI, not opt the user into the new
    // one — chat.ts stamps the field on the first frame, so in-flight staged
    // turns always have it by the time a stage row exists.
    render(
      <Message
        msg={baseMsg({ content: "", statusLine: "searching…", stageLog: [{ stage: "querying", detail: "Searching…", at: 0 }] })}
        streaming
        showTrace={false}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.queryByText("Looking for evidence")).toBeNull();
    expect(screen.getByText("searching…")).toBeInTheDocument();
  });

  it("streaming mode keeps the plain empty bubble on an empty done turn (no stopped row)", () => {
    render(
      <Message
        msg={baseMsg({ delivery: "streaming", done: true, content: "", stageLog: [{ stage: "querying", detail: null, at: 0 }] })}
        streaming={false}
        showTrace={false}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.queryByText("Stopped before an answer was ready.")).toBeNull();
  });

  it("shows a muted stopped row for an aborted staged turn (done, empty content, stages ran)", () => {
    render(
      <Message
        msg={baseMsg({ delivery: "staged", done: true, content: "", stageLog: [{ stage: "querying", detail: "Searching…", at: 0 }] })}
        streaming={false}
        showTrace={false}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.getByText("Stopped before an answer was ready.")).toBeInTheDocument();
  });

  it("renders an unrecognized stage's raw name, capitalized", () => {
    render(
      <Message
        msg={baseMsg({ delivery: "staged", stageLog: [{ stage: "escalating", detail: null, at: 0 }] })}
        streaming
        showTrace={false}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.getByText("Escalating")).toBeInTheDocument();
  });
});

describe("Message staged-mode reveal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.classList.remove("rlc-nomotion");
  });

  it("types out the final answer once, gated on content being empty right before done", () => {
    const msg = baseMsg({ content: "", stageLog: [{ stage: "finalizing", detail: null, at: 0 }] });
    const { rerender } = render(<Message msg={msg} streaming showTrace={false} onAtlas={vi.fn()} />);

    const full = "The Operational Facilitator budget is signed off by the Prime Agent each quarter.";
    act(() => {
      rerender(<Message msg={{ ...msg, content: full, done: true }} streaming={false} showTrace={false} onAtlas={vi.fn()} />);
    });
    // Mid-reveal: not yet the full text, but visibly progressing (a caret shows).
    expect(screen.queryByText(full)).toBeNull();
    expect(document.querySelector(".rlc-caret")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000); // well past the ~1.8s cap
    });
    expect(screen.getByText(full)).toBeInTheDocument();
    expect(document.querySelector(".rlc-caret")).toBeNull();
  });

  it("does NOT re-animate a streaming-mode done (content already present beforehand)", () => {
    const msg = baseMsg({ content: "Hello", done: false });
    const { rerender } = render(<Message msg={msg} streaming showTrace={false} onAtlas={vi.fn()} />);

    act(() => {
      rerender(<Message msg={{ ...msg, content: "Hello world", done: true }} streaming={false} showTrace={false} onAtlas={vi.fn()} />);
    });
    // Full text is immediately present — no interval needed to catch up.
    expect(screen.getByText("Hello world")).toBeInTheDocument();
    expect(document.querySelector(".rlc-caret")).toBeNull();
  });

  it("reveals instantly under prefers-reduced-motion (rlc-nomotion)", () => {
    document.body.classList.add("rlc-nomotion");
    const msg = baseMsg({ content: "", stageLog: [{ stage: "finalizing", detail: null, at: 0 }] });
    const { rerender } = render(<Message msg={msg} streaming showTrace={false} onAtlas={vi.fn()} />);

    const full = "Instant under reduced motion.";
    act(() => {
      rerender(<Message msg={{ ...msg, content: full, done: true }} streaming={false} showTrace={false} onAtlas={vi.fn()} />);
    });
    expect(screen.getByText(full)).toBeInTheDocument();
    expect(document.querySelector(".rlc-caret")).toBeNull();
  });
});
