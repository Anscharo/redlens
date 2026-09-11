// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Message } from "./Message";
import type { ChatMsg } from "./useChatStream";

vi.mock("../../lib/docs", () => ({ loadAtlas: () => Promise.resolve({ docs: {} }) }));
vi.mock("../../lib/analytics", () => ({ track: vi.fn() }));

afterEach(cleanup);

function baseMsg(over: Partial<ChatMsg>): ChatMsg {
  return {
    role: "assistant",
    content: "",
    draft: "",
    generated: false,
    trace: [],
    rounds: 0,
    sources: [],
    done: false,
    stageLog: [],
    ...over,
  };
}

describe("Message", () => {
  it("renders a user turn as plain text in a bubble", () => {
    render(<Message msg={{ ...baseMsg({}), role: "user", content: "hi there" }} streaming={false} onAtlas={vi.fn()} />);
    expect(screen.getByText("you")).toBeInTheDocument();
    expect(screen.getByText("hi there")).toBeInTheDocument();
  });

  it("shows a thinking placeholder for a streaming assistant turn with no content and no stage row yet", () => {
    render(<Message msg={baseMsg({ statusLine: "searching…" })} streaming onAtlas={vi.fn()} />);
    expect(screen.getByText("searching…")).toBeInTheDocument();
  });

  it("defaults the thinking placeholder text when no statusLine is set", () => {
    render(<Message msg={baseMsg({})} streaming onAtlas={vi.fn()} />);
    expect(screen.getByText("searching the stars…")).toBeInTheDocument();
  });

  it("shows Sources once done and generated, using content-derived citations", () => {
    render(
      <Message
        msg={baseMsg({
          content: "See [Doc](/atlas/11111111-1111-1111-1111-111111111111)",
          done: true,
        })}
        streaming={false}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.getByText("sources · 1")).toBeInTheDocument();
  });

  it("shows a distinct failed-turn notice for a done, empty, failed assistant message", () => {
    render(<Message msg={baseMsg({ done: true, failed: true })} streaming={false} onAtlas={vi.fn()} />);
    expect(screen.getByText(/This reply didn.t come through/)).toBeInTheDocument();
    expect(document.querySelector(".rlc-turn-error")).toBeInTheDocument();
  });

  it("does not show the failed-turn notice once real content has arrived, even if failed lingers", () => {
    render(<Message msg={baseMsg({ content: "an actual answer", done: true, failed: true })} streaming={false} onAtlas={vi.fn()} />);
    expect(screen.queryByText(/This reply didn.t come through/)).toBeNull();
    expect(screen.getByText("an actual answer")).toBeInTheDocument();
  });

  it("prefers the thinking placeholder over the failed notice while still streaming", () => {
    render(<Message msg={baseMsg({ failed: true })} streaming onAtlas={vi.fn()} />);
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
            content: "an answer",
            done: true,
            exports: [{ format: "csv", filename: "data.csv", mime: "text/csv;charset=utf-8", content: "a", bytes: 1 }],
          })}
          streaming={false}
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

  it("shows a VerifyBadge when a generated message carries a verify state", () => {
    render(
      <Message
        msg={baseMsg({
          content: "an answer",
          done: true,
          verify: {
            status: "pass",
            contradictions: [],
            notFound: [],
            rulingIssued: false,
            invalidCitations: [],
            invalidDocNos: [],
            docNoMismatches: [],
            ungroundedQuotes: [],
            ungroundedAddresses: [],
            ungroundedCitationValues: [],
            paramMismatches: [],
            completenessFailures: [],
            missingExternalDisclaimer: false,
            mscCitedAsAtlas: [],
            lengthCapped: false,
          },
        })}
        streaming={false}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.getByText("no contradictions found")).toBeInTheDocument();
  });
});

describe("Message stage checklist", () => {
  it("renders the checklist (labels + active detail) while in flight, whatever the streaming prop reads", () => {
    for (const streaming of [true, false]) {
      cleanup();
      render(
        <Message
          msg={baseMsg({ stageLog: [{ stage: "querying", details: ["Searching the atlas for facilitator rewards…"], at: 0, round: 1 }] })}
          streaming={streaming}
          onAtlas={vi.fn()}
        />,
      );
      expect(screen.getByText("Looking for evidence")).toBeInTheDocument();
      expect(screen.getByText("Searching the atlas for facilitator rewards…")).toBeInTheDocument();
    }
  });

  it("supersedes the old plain thinking placeholder once a stage row exists", () => {
    render(
      <Message
        msg={baseMsg({ stageLog: [{ stage: "querying", details: ["Searching…"], at: 0, round: 1 }] })}
        streaming
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.queryByText("searching the stars…")).toBeNull();
  });

  it("coalesces to the latest row as active; earlier rows keep their own detail line visible too", () => {
    render(
      <Message
        msg={baseMsg({
          stageLog: [
            { stage: "querying", details: ["Searching…"], at: 0, round: 1 },
            { stage: "checking", details: ["Auditing 3 claims…"], at: 1, round: 1 },
          ],
        })}
        streaming
        onAtlas={vi.fn()}
      />,
    );
    // querying (at 0) is done now that checking is the running row; its
    // label and ellipsis both read as finished, while the active row keeps
    // its present-continuous label and untouched detail copy.
    expect(screen.getByText("Looked for evidence")).toBeInTheDocument();
    expect(screen.getByText("Verifying content")).toBeInTheDocument();
    expect(screen.getByText("Auditing 3 claims…")).toBeInTheDocument();
    expect(screen.getByText("Searching")).toBeInTheDocument();
  });

  it("renders the comparing and verifying rows AFTER the answer, the rest before it", () => {
    const msg = baseMsg({
      content: "the answer text",
      generated: true,
      stageLog: [
        { stage: "querying", details: ["Searching…"], at: 0, round: 1 },
        { stage: "synthesizing", details: [], at: 1, round: 1 },
        { stage: "comparing", details: ["Comparing the draft…"], at: 2, round: 1 },
        { stage: "checking", details: ["Cross-checking…"], at: 3, round: 1 },
      ],
    });
    render(<Message msg={msg} streaming onAtlas={vi.fn()} />);
    const answer = screen.getByText("the answer text");
    const after = (label: string) => !!(answer.compareDocumentPosition(screen.getByText(label)) & Node.DOCUMENT_POSITION_FOLLOWING);
    // Only checking (the last/active entry) is still running; every earlier
    // stage — including comparing, which sits after the answer — is done.
    expect(after("Looked for evidence")).toBe(false);
    expect(after("Synthesized")).toBe(false);
    expect(after("Compared results")).toBe(true);
    expect(after("Verifying content")).toBe(true);
    // Only the running stage (the last logged) is active, across both lists.
    const active = document.querySelectorAll('li.rlc-stage[data-state="active"]');
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toContain("Verifying content");
  });

  it("does not fold a live turn's checklist when it finishes — nothing on screen moves at the final render", () => {
    const live = baseMsg({
      generated: false,
      stageLog: [
        { stage: "querying", details: ["Searching…"], at: 0, round: 1 },
        { stage: "synthesizing", details: [], at: 1, round: 1 },
      ],
      trace: [{ name: "atlas_get", args: {}, ok: true, bytes: 5, round: 1 }],
    });
    const { rerender } = render(<Message msg={live} streaming onAtlas={vi.fn()} />);
    rerender(<Message msg={{ ...live, content: "done answer", generated: true, done: true, rounds: 1 }} streaming={false} onAtlas={vi.fn()} />);
    // The turn is over, so every row — including the one that was running —
    // now reads in the simple past.
    expect(screen.getByText("Looked for evidence")).toBeInTheDocument();
    expect(screen.getByText("Synthesized")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /atlas lookups and reasoning/ })).toBeNull();
  });

  it("collapses to a one-line summary when a finished turn mounts (reopened panel / loaded thread)", () => {
    render(
      <Message
        msg={baseMsg({
          content: "the answer",
          done: true,
          rounds: 1,
          trace: [{ name: "atlas_get", args: {}, ok: true, bytes: 5, round: 1 }],
          stageLog: [{ stage: "querying", details: ["Searching…"], at: 0, round: 1 }],
        })}
        streaming={false}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.queryByText("Looking for evidence")).toBeNull();
    expect(screen.getByRole("button", { name: /atlas lookups and reasoning/ })).toBeInTheDocument();
  });

  it("shows a muted stopped row for a turn that ended with no content, no failure, and stages that ran", () => {
    render(
      <Message
        msg={baseMsg({ done: true, stageLog: [{ stage: "querying", details: ["Searching…"], at: 0, round: 1 }] })}
        streaming={false}
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.getByText("Stopped before an answer was ready.")).toBeInTheDocument();
  });

  it("does not show the stopped row for a done, empty, NOT-failed turn with no stages at all", () => {
    render(<Message msg={baseMsg({ done: true })} streaming={false} onAtlas={vi.fn()} />);
    expect(screen.queryByText("Stopped before an answer was ready.")).toBeNull();
  });

  it("shows a stage row's working content once that row is clicked open, and hides it again on a second click", () => {
    render(
      <Message
        msg={baseMsg({
          reasoning: "Thinking about the right documents to check.",
          stageLog: [{ stage: "synthesizing", details: [], at: 0, round: 1 }],
        })}
        streaming
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.queryByText("Thinking about the right documents to check.")).toBeNull();

    const toggle = screen.getByRole("button", { name: /Synthesizing/ });
    fireEvent.click(toggle);
    expect(screen.getByText("Thinking about the right documents to check.")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.queryByText("Thinking about the right documents to check.")).toBeNull();
  });

  it("shows the live draft once the synthesizing row is clicked open", () => {
    render(
      <Message
        msg={baseMsg({
          draft: "The Prime Agent budget is",
          stageLog: [{ stage: "synthesizing", details: [], at: 0, round: 1 }],
        })}
        streaming
        onAtlas={vi.fn()}
      />,
    );
    expect(screen.queryByText("The Prime Agent budget is")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Synthesizing/ }));
    expect(screen.getByText("The Prime Agent budget is")).toBeInTheDocument();
  });

  // Regression: the slot used to render INSIDE the row's toggle <button>, so
  // a nested interactive element (ReasoningBlock's own "thinking" toggle)
  // both produced invalid <button><button> nesting and bubbled its click up
  // to the outer toggle, collapsing the row the instant the reader tried to
  // fold the reasoning trace back up. The slot must be a sibling of the
  // toggle, not a child of it.
  it("does not collapse the row when clicking an interactive element inside its open slot", () => {
    render(
      <Message
        msg={baseMsg({
          reasoning: "Thinking about the right documents to check.",
          stageLog: [{ stage: "synthesizing", details: [], at: 0, round: 1 }],
        })}
        streaming
        onAtlas={vi.fn()}
      />,
    );
    const rowToggle = screen.getByRole("button", { name: /Synthesizing/ });
    fireEvent.click(rowToggle);
    expect(screen.getByText("Thinking about the right documents to check.")).toBeInTheDocument();

    // ReasoningBlock's own collapsible "thinking" header, nested inside the
    // stage row's now-open slot.
    fireEvent.click(screen.getByRole("button", { name: "thinking" }));
    expect(rowToggle).toHaveAttribute("aria-expanded", "true");
  });
});

describe("Message answer generation", () => {
  it("hides the answer until the message is generated, even mid-turn with stage activity", () => {
    render(
      <Message
        msg={baseMsg({ generated: false, stageLog: [{ stage: "synthesizing", details: [], at: 0, round: 1 }] })}
        streaming
        onAtlas={vi.fn()}
      />,
    );
    expect(document.querySelector(".rlc-answer")).toBeNull();
  });

  it("shows the answer once generated flips true, even before done (an answer_final reveal)", () => {
    render(<Message msg={baseMsg({ content: "the revealed answer", generated: true, done: false })} streaming onAtlas={vi.fn()} />);
    expect(screen.getByText("the revealed answer")).toBeInTheDocument();
    expect(document.querySelector(".rlc-answer")?.getAttribute("data-state")).toBe("provisional");
  });

  it("reveals on done even when generated never explicitly arrived (an early-exit turn with no answer_final)", () => {
    render(<Message msg={baseMsg({ content: "early-exit answer", generated: false, done: true })} streaming={false} onAtlas={vi.fn()} />);
    expect(screen.getByText("early-exit answer")).toBeInTheDocument();
  });
});

describe("Message answer reveal", () => {
  const synth = [{ stage: "synthesizing", details: [], at: 0, round: 1 }];

  it("shows the whole answer at once on `generated` — no typewriter, no caret", () => {
    const msg = baseMsg({ generated: false, stageLog: synth });
    const { rerender } = render(<Message msg={msg} streaming onAtlas={vi.fn()} />);
    const full = "The Operational Facilitator budget is signed off by the Prime Agent each quarter.";
    rerender(<Message msg={{ ...msg, content: full, generated: true }} streaming={false} onAtlas={vi.fn()} />);
    expect(screen.getByText(full)).toBeInTheDocument();
    expect(document.querySelector(".rlc-caret")).toBeNull();
  });

  it("calls onAnswerReveal once, with the answer element, when generated flips true", () => {
    const onAnswerReveal = vi.fn();
    const msg = baseMsg({ generated: false, stageLog: synth });
    const { rerender } = render(<Message msg={msg} streaming onAtlas={vi.fn()} onAnswerReveal={onAnswerReveal} />);
    expect(onAnswerReveal).not.toHaveBeenCalled();
    const revealed = { ...msg, content: "An answer.", generated: true };
    rerender(<Message msg={revealed} streaming={false} onAtlas={vi.fn()} onAnswerReveal={onAnswerReveal} />);
    expect(onAnswerReveal).toHaveBeenCalledTimes(1);
    expect(onAnswerReveal.mock.calls[0][0]).toBe(document.querySelector(".rlc-answer"));
    // Later updates to the same turn (verify badge, done) do not re-fire it.
    rerender(<Message msg={{ ...revealed, done: true }} streaming={false} onAtlas={vi.fn()} onAnswerReveal={onAnswerReveal} />);
    expect(onAnswerReveal).toHaveBeenCalledTimes(1);
  });

  it("does not call onAnswerReveal for a message that mounts already generated (hydrated thread)", () => {
    const onAnswerReveal = vi.fn();
    render(<Message msg={baseMsg({ content: "Loaded answer.", done: true })} streaming={false} onAtlas={vi.fn()} onAnswerReveal={onAnswerReveal} />);
    expect(onAnswerReveal).not.toHaveBeenCalled();
  });
});

describe("Message provisional answer rendering", () => {
  const verify = {
    contradictions: [],
    notFound: [],
    rulingIssued: false,
    invalidCitations: [],
    invalidDocNos: [],
    docNoMismatches: [],
    ungroundedQuotes: [],
    ungroundedAddresses: [],
    ungroundedCitationValues: [],
    paramMismatches: [],
    completenessFailures: [],
    missingExternalDisclaimer: false,
    mscCitedAsAtlas: [],
    lengthCapped: false,
  };

  it("marks the answer provisional while still streaming (not done)", () => {
    render(<Message msg={baseMsg({ content: "partial answer", generated: true, done: false })} streaming onAtlas={vi.fn()} />);
    expect(document.querySelector(".rlc-answer")?.getAttribute("data-state")).toBe("provisional");
  });

  it("stays provisional while verify.status is 'checking', even once generated", () => {
    render(
      <Message
        msg={baseMsg({ content: "an answer awaiting audit", generated: true, done: false, verify: { status: "checking", ...verify } })}
        streaming
        onAtlas={vi.fn()}
      />,
    );
    expect(document.querySelector(".rlc-answer")?.getAttribute("data-state")).toBe("provisional");
  });

  it("flips to final at done with a resolved verdict", () => {
    render(
      <Message
        msg={baseMsg({ content: "a checked answer", done: true, verify: { status: "pass", ...verify } })}
        streaming={false}
        onAtlas={vi.fn()}
      />,
    );
    expect(document.querySelector(".rlc-answer")?.getAttribute("data-state")).toBe("final");
  });

  it("flips to final at done even with no verifier at all (verify never set)", () => {
    render(<Message msg={baseMsg({ content: "an unverified-mode answer", done: true })} streaming={false} onAtlas={vi.fn()} />);
    expect(document.querySelector(".rlc-answer")?.getAttribute("data-state")).toBe("final");
  });
});
