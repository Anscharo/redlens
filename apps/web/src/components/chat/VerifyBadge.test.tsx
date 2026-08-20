// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
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
};

describe("VerifyBadge", () => {
  it("renders nothing when unverified (harness off or degraded)", () => {
    const { container } = render(<VerifyBadge verify={{ ...base, status: "unverified" }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the checking label and is not expandable while verifying", () => {
    render(<VerifyBadge verify={{ ...base, status: "checking" }} />);
    const btn = screen.getByRole("button");
    expect(btn).toHaveTextContent("verifying…");
    expect(btn).toBeDisabled();
    expect(btn).not.toHaveAttribute("aria-expanded");
  });

  it("shows the pass label with no issues and stays unexpandable", () => {
    render(<VerifyBadge verify={{ ...base, status: "pass" }} />);
    const btn = screen.getByRole("button");
    expect(btn).toHaveTextContent("verified against the atlas");
    expect(btn).toBeDisabled();
  });

  it("shows the revised label", () => {
    render(<VerifyBadge verify={{ ...base, status: "revised" }} />);
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
    render(<VerifyBadge verify={verify} />);
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
    render(<VerifyBadge verify={verify} />);
    expect(screen.getByRole("button")).toHaveTextContent("caution: 1 unsupported claim");
  });

  it("shows the fail label", () => {
    render(<VerifyBadge verify={{ ...base, status: "fail", claims: [{ claim: "bad", status: "contradicted" }] }} />);
    expect(screen.getByRole("button")).toHaveTextContent("failed verification");
  });
});
