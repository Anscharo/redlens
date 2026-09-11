// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StageSlot } from "./StageSlot";
import type { StageSlotContent } from "./stageSlotContent";
import type { VerifyState } from "./chatTypes";

vi.mock("../../lib/docs", () => ({ loadAtlas: () => Promise.resolve({ docs: {} }) }));
vi.mock("../../lib/analytics", () => ({ track: vi.fn() }));

afterEach(cleanup);

const show = (content: StageSlotContent) => render(<StageSlot content={content} onAtlas={vi.fn()} />);

describe("StageSlot / trace", () => {
  it("renders one row per trace entry, facts and tool calls alike", () => {
    show({
      kind: "trace",
      rows: [
        { name: "glossary", args: {}, ok: true, bytes: null, kind: "fact", summary: "2 definitions", round: 0 },
        { name: "atlas_get", args: { id: "abc" }, ok: true, bytes: 5, round: 1 },
      ],
    });
    expect(screen.getByText("2 definitions")).toBeInTheDocument();
    expect(screen.getByText("atlas_get")).toBeInTheDocument();
  });
});

describe("StageSlot / synthesis", () => {
  it("renders reasoning, superseded drafts and the live draft together", () => {
    show({
      kind: "synthesis",
      reasoning: "thinking it through",
      drafts: [{ text: "round 1 preamble", reason: "tool_round", round: 1 }],
      draft: "the answer so far",
    });
    expect(screen.getByText("thinking it through")).toBeInTheDocument();
    expect(screen.getByText("round 1 preamble")).toBeInTheDocument();
    expect(screen.getByText("the answer so far")).toBeInTheDocument();
  });

  it("omits the parts the content left out", () => {
    const { container } = show({ kind: "synthesis", drafts: [], draft: "only the draft" });
    expect(screen.getByText("only the draft")).toBeInTheDocument();
    expect(container.querySelector(".rlc-reasoning")).toBeNull();
    expect(container.querySelector(".rlc-superseded")).toBeNull();
  });

  it("still renders the draft box for an empty live draft — the row was opened to watch it fill", () => {
    const { container } = show({ kind: "synthesis", drafts: [], draft: "" });
    expect(container.querySelector(".rlc-stage-draft")).toBeInTheDocument();
  });
});

describe("StageSlot / checks", () => {
  const verify: VerifyState = {
    status: "fail",
    contradictions: [],
    notFound: [],
    rulingIssued: true,
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

  it("renders the paragraph checks and the whole-answer findings", () => {
    const { container } = show({
      kind: "checks",
      checks: [{ index: 0, text: "final paragraph", findings: [] }],
      findings: verify,
    });
    expect(container.querySelector(".rlc-para-checks")).toBeInTheDocument();
    expect(container.querySelector(".rlc-verify-claims")).toBeInTheDocument();
  });

  it("renders the paragraph checks alone when there are no whole-answer findings", () => {
    const { container } = show({ kind: "checks", checks: [{ index: 0, text: "final paragraph", findings: [] }] });
    expect(container.querySelector(".rlc-para-checks")).toBeInTheDocument();
    expect(container.querySelector(".rlc-verify-claims")).toBeNull();
  });
});
