// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { VerifyBadge } from "./VerifyBadge";
import type { VerifyState } from "./useChatStream";

afterEach(cleanup);

const base: Omit<VerifyState, "status"> = {
  claims: [],
  invalidCitations: [],
  invalidDocNos: [],
  docNoMismatches: [],
  ungroundedQuotes: [],
  ungroundedAddresses: [],
  ungroundedCitationValues: [],
  paramMismatches: [],
  lengthCapped: false,
};

const noop = () => {};

describe("VerifyBadge", () => {
  it("renders nothing when unverified (harness off or degraded)", () => {
    const { container } = render(<VerifyBadge verify={{ ...base, status: "unverified" }} onAtlas={noop} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the checking label and is not expandable while verifying", () => {
    render(<VerifyBadge verify={{ ...base, status: "checking" }} onAtlas={noop} />);
    const btn = screen.getByRole("button");
    expect(btn).toHaveTextContent("verifying…");
    expect(btn).toBeDisabled();
    expect(btn).not.toHaveAttribute("aria-expanded");
  });

  it("shows the pass label with no issues and stays unexpandable", () => {
    render(<VerifyBadge verify={{ ...base, status: "pass" }} onAtlas={noop} />);
    const btn = screen.getByRole("button");
    expect(btn).toHaveTextContent("verified against the atlas");
    expect(btn).toBeDisabled();
  });

  it("shows the revised label", () => {
    render(<VerifyBadge verify={{ ...base, status: "revised" }} onAtlas={noop} />);
    expect(screen.getByRole("button")).toHaveTextContent("revised after a verification check");
  });

  it("shows a pluralized caution count for warn status and expands claim details on click", () => {
    const verify: VerifyState = {
      ...base,
      status: "warn",
      claims: [
        { claim: "Sky is a DAO", status: "unsupported" },
        { claim: "This is fine", status: "supported" },
      ],
      invalidCitations: ["11111111-1111-1111-1111-111111111111"],
      invalidDocNos: ["A.9.9"],
      docNoMismatches: ["A.1.1"],
      ungroundedQuotes: ["a".repeat(150)],
      ungroundedAddresses: ["0xabc"],
    };
    render(<VerifyBadge verify={verify} onAtlas={noop} />);
    const btn = screen.getByRole("button");
    // 1 unsupported claim + 1 invalidCitation + 1 invalidDocNo + 1 docNoMismatch + 1 quote + 1 address = 6
    expect(btn).toHaveTextContent("caution: 6 unsupported claims");
    expect(btn).not.toBeDisabled();
    expect(btn).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/cites a document that does not exist/)).toBeInTheDocument();
    expect(screen.getByText(/document number does not exist in the atlas/)).toBeInTheDocument();
    expect(screen.getByText(/document number doesn’t match its link: A.1.1/)).toBeInTheDocument();
    expect(screen.getByText(/quote not found in any retrieved source/)).toBeInTheDocument();
    expect(screen.getByText(/…”/)).toBeInTheDocument(); // truncated long quote
    expect(screen.getByText(/address not found in any retrieved source/)).toBeInTheDocument();
    expect(screen.getByText("Sky is a DAO")).toBeInTheDocument();
    // supported claims are filtered out of the flagged list
    expect(screen.queryByText("This is fine")).toBeNull();
  });

  it("uses singular claim wording for exactly one unsupported claim", () => {
    const verify: VerifyState = {
      ...base,
      status: "warn",
      claims: [{ claim: "one bad claim", status: "contradicted" }],
    };
    render(<VerifyBadge verify={verify} onAtlas={noop} />);
    expect(screen.getByRole("button")).toHaveTextContent("caution: 1 unsupported claim");
  });

  it("shows the fail label", () => {
    render(<VerifyBadge verify={{ ...base, status: "fail", claims: [{ claim: "bad", status: "contradicted" }] }} onAtlas={noop} />);
    expect(screen.getByRole("button")).toHaveTextContent("failed verification");
  });

  // Regression: a param mismatch is a HARD server-side failure that can be the
  // ONLY finding — the verifier's claim table stays clean because the sentence
  // is well-supported prose, it just states the wrong number. Before these two
  // arrays reached the client, such a turn rendered an unexpandable red chip
  // that told the user the answer failed and then refused to say why.
  it("expands and explains a param mismatch that is the only finding", () => {
    const verify: VerifyState = {
      ...base,
      status: "fail",
      paramMismatches: [
        { stated: "50,000", actual: "10,000 USDS", name: "maxamount", title: "USDS Mint Maximum", owner: "keel", uuid: "u-1", doc_no: "T.1.1" },
      ],
    };
    render(<VerifyBadge verify={verify} onAtlas={noop} />);
    const btn = screen.getByRole("button");
    expect(btn).not.toBeDisabled();

    fireEvent.click(btn);
    // Reader-facing title, not the terse extracted kv key.
    expect(screen.getByText("USDS Mint Maximum")).toBeInTheDocument();
    expect(screen.queryByText("maxamount")).not.toBeInTheDocument();
    // Attributed to our extraction rather than asserted as atlas text.
    expect(screen.getByRole("listitem")).toHaveTextContent("our reading of the atlas has");
    expect(screen.getByRole("link")).toHaveAttribute("href", expect.stringContaining("u-1"));
  });

  it("expands a value cited to the wrong document when it is the only finding", () => {
    const verify: VerifyState = { ...base, status: "fail", ungroundedCitationValues: ["0.2% cited to A.1.1 (Reward Rate) but absent from it"] };
    render(<VerifyBadge verify={verify} onAtlas={noop} />);
    const btn = screen.getByRole("button");
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(screen.getByRole("listitem")).toHaveTextContent("0.2% cited to A.1.1");
  });

  // Third trigger of the same class: repairedChecks folds lengthCapped into
  // `failed`, so an answer cut off mid-generation fails with every findings
  // array empty.
  it("expands and explains a length-capped answer that is the only finding", () => {
    render(<VerifyBadge verify={{ ...base, status: "fail", lengthCapped: true }} onAtlas={noop} />);
    const btn = screen.getByRole("button");
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(screen.getByRole("listitem")).toHaveTextContent("cut off by the output length limit");
  });

  it("invokes onAtlas instead of navigating when a param mismatch link is clicked", () => {
    const onAtlas = vi.fn();
    const verify: VerifyState = {
      ...base,
      status: "fail",
      paramMismatches: [
        { stated: "50,000", actual: "10,000 USDS", name: "maxamount", title: "USDS Mint Maximum", owner: null, uuid: "u-1", doc_no: "T.1.1" },
      ],
    };
    render(<VerifyBadge verify={verify} onAtlas={onAtlas} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("link"));
    expect(onAtlas).toHaveBeenCalledWith("u-1");
  });
});
