// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderStageSlot } from "./StageSlots";
import type { ChatMsg, StageLogEntry } from "./useChatStream";

vi.mock("../../lib/docs", () => ({ loadAtlas: () => Promise.resolve({ docs: {} }) }));
vi.mock("../../lib/analytics", () => ({ track: vi.fn() }));

afterEach(cleanup);

function baseMsg(over: Partial<ChatMsg> = {}): ChatMsg {
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

const entry = (over: Partial<StageLogEntry>): StageLogEntry => ({ stage: "querying", details: [], at: 0, round: 1, ...over });

function Slot({ msg, e, active = true }: { msg: ChatMsg; e: StageLogEntry; active?: boolean }) {
  return <>{renderStageSlot(msg, e, active, vi.fn())}</>;
}

describe("renderStageSlot / recalling", () => {
  it("renders only the fact rows from trace, regardless of round", () => {
    const msg = baseMsg({
      trace: [
        { name: "glossary", args: {}, ok: true, bytes: null, kind: "fact", summary: "2 definitions", round: 0 },
        { name: "atlas_get", args: {}, ok: true, bytes: 5, round: 1 },
      ],
    });
    render(<Slot msg={msg} e={entry({ stage: "recalling", round: 0 })} />);
    expect(screen.getByText("2 definitions")).toBeInTheDocument();
    expect(screen.queryByText("atlas_get")).toBeNull();
  });

  it("renders nothing when there are no fact rows", () => {
    const { container } = render(<Slot msg={baseMsg()} e={entry({ stage: "recalling", round: 0 })} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("renderStageSlot / querying", () => {
  it("renders only tool rows for that entry's round, excluding facts and other rounds", () => {
    const msg = baseMsg({
      trace: [
        { name: "glossary", args: {}, ok: true, bytes: null, kind: "fact", summary: "def", round: 0 },
        { name: "atlas_get", args: { id: "r1" }, ok: true, bytes: 5, round: 1 },
        { name: "atlas_query", args: { id: "r2" }, ok: true, bytes: 5, round: 2 },
      ],
    });
    render(<Slot msg={msg} e={entry({ stage: "querying", round: 1 })} />);
    expect(screen.getByText("atlas_get")).toBeInTheDocument();
    expect(screen.queryByText("atlas_query")).toBeNull();
    expect(screen.queryByText("def")).toBeNull();
  });
});

describe("renderStageSlot / synthesizing", () => {
  it("shows reasoning only on the FIRST synthesizing entry", () => {
    const msg = baseMsg({
      reasoning: "thinking it through",
      stageLog: [entry({ stage: "synthesizing", at: 0, round: 1 }), entry({ stage: "synthesizing", at: 3, round: 2 })],
    });
    const first = msg.stageLog![0];
    const second = msg.stageLog![1];
    const { unmount } = render(<Slot msg={msg} e={first} />);
    expect(screen.getByText("thinking it through")).toBeInTheDocument();
    unmount();
    render(<Slot msg={msg} e={second} />);
    expect(screen.queryByText("thinking it through")).toBeNull();
  });

  it("shows that round's superseded drafts only", () => {
    const msg = baseMsg({
      superseded: [
        { text: "round 1 preamble", reason: "tool_round", round: 1 },
        { text: "round 2 preamble", reason: "tool_round", round: 2 },
      ],
    });
    render(<Slot msg={msg} e={entry({ stage: "synthesizing", round: 1 })} />);
    expect(screen.getByText("round 1 preamble")).toBeInTheDocument();
    expect(screen.queryByText("round 2 preamble")).toBeNull();
  });

  it("shows the live draft only on the LAST synthesizing entry while the answer isn't generated yet", () => {
    const msg = baseMsg({
      draft: "the answer so far",
      generated: false,
      stageLog: [entry({ stage: "synthesizing", at: 0, round: 1 }), entry({ stage: "synthesizing", at: 3, round: 2 })],
    });
    const first = msg.stageLog![0];
    const last = msg.stageLog![1];
    const { unmount } = render(<Slot msg={msg} e={first} />);
    expect(screen.queryByText("the answer so far")).toBeNull();
    unmount();
    render(<Slot msg={msg} e={last} />);
    expect(screen.getByText("the answer so far")).toBeInTheDocument();
  });

  it("hides the live draft once the answer has been generated", () => {
    const msg = baseMsg({
      draft: "stale draft text",
      generated: true,
      stageLog: [entry({ stage: "synthesizing", at: 0, round: 1 })],
    });
    render(<Slot msg={msg} e={msg.stageLog![0]} />);
    expect(screen.queryByText("stale draft text")).toBeNull();
  });

  it("renders nothing when there is no reasoning, no drafts, and no live draft to show", () => {
    const msg = baseMsg({ generated: true, stageLog: [entry({ stage: "synthesizing", at: 0, round: 1 })] });
    const { container } = render(<Slot msg={msg} e={msg.stageLog![0]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("never renders paragraph checks under a synthesizing entry", () => {
    const msg = baseMsg({
      draft: "the answer so far",
      paragraphChecks: [{ index: 0, text: "the answer so far", findings: [] }],
      stageLog: [entry({ stage: "synthesizing", at: 0, round: 1 }), entry({ stage: "synthesizing", at: 3, round: 2 })],
    });
    for (const e of msg.stageLog!) {
      const { container, unmount } = render(<Slot msg={msg} e={e} />);
      expect(container.querySelector(".rlc-para-checks")).toBeNull();
      unmount();
    }
  });
});

describe("renderStageSlot / comparing", () => {
  it("shows paragraph checks under Comparing when the turn has no Verifying row (deterministic-only)", () => {
    const msg = baseMsg({
      generated: true,
      paragraphChecks: [{ index: 0, text: "final paragraph", findings: [] }],
      stageLog: [entry({ stage: "synthesizing", at: 0, round: 1 }), entry({ stage: "comparing", at: 1, round: 1 })],
    });
    const { container } = render(<Slot msg={msg} e={msg.stageLog![1]} />);
    expect(container.querySelector(".rlc-para-checks")).toBeInTheDocument();
  });

  it("leaves Comparing empty when a Verifying row exists — the checks live there instead", () => {
    const msg = baseMsg({
      generated: true,
      paragraphChecks: [{ index: 0, text: "final paragraph", findings: [] }],
      stageLog: [
        entry({ stage: "comparing", at: 1, round: 1 }),
        entry({ stage: "checking", at: 2, round: 1 }),
      ],
    });
    const { container: comparing } = render(<Slot msg={msg} e={msg.stageLog![0]} />);
    expect(comparing.querySelector(".rlc-para-checks")).toBeNull();
    const { container: checking } = render(<Slot msg={msg} e={msg.stageLog![1]} />);
    expect(checking.querySelector(".rlc-para-checks")).toBeInTheDocument();
  });
});

describe("renderStageSlot / checking", () => {
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

  it("renders findings once verify has resolved with something to report", () => {
    const msg = baseMsg({ verify: { status: "fail", ...verify, rulingIssued: true } });
    const { container } = render(<Slot msg={msg} e={entry({ stage: "checking", round: 1 })} />);
    expect(container.querySelector(".rlc-verify-claims")).toBeInTheDocument();
  });

  it("renders nothing for a clean verdict — an empty findings box looks like a mistake", () => {
    const msg = baseMsg({ verify: { status: "pass", ...verify } });
    const { container } = render(<Slot msg={msg} e={entry({ stage: "checking", round: 1 })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while verify is still checking", () => {
    const msg = baseMsg({ verify: { status: "checking", ...verify } });
    const { container } = render(<Slot msg={msg} e={entry({ stage: "checking", round: 1 })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when verify was never set", () => {
    const { container } = render(<Slot msg={baseMsg()} e={entry({ stage: "checking", round: 1 })} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("renderStageSlot / comparing", () => {
  it("always renders nothing", () => {
    const { container } = render(<Slot msg={baseMsg()} e={entry({ stage: "comparing", round: 1 })} />);
    expect(container).toBeEmptyDOMElement();
  });
});
