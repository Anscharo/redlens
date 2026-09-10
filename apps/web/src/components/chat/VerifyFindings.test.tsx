// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { VerifyFindings } from "./VerifyFindings";
import type { VerifyState } from "./useChatStream";

afterEach(cleanup);

const base: VerifyState = {
  status: "fail",
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

const noop = () => {};

describe("VerifyFindings", () => {
  it("renders nothing at all when there are no findings", () => {
    const { container } = render(<VerifyFindings verify={{ ...base, status: "pass" }} onAtlas={noop} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a contradiction row with the answer, evidence, and reason", () => {
    render(
      <VerifyFindings
        verify={{
          ...base,
          contradictions: [{ answer: "Sky is a DAO", evidence: "Sky is a protocol, not a DAO", why: "the atlas never calls it a DAO", uuid: null }],
        }}
        onAtlas={noop}
      />,
    );
    const row = screen.getByRole("listitem");
    expect(row).toHaveAttribute("data-status", "contradicted");
    expect(row).toHaveTextContent("Sky is a DAO");
    expect(row).toHaveTextContent("the atlas says:");
    expect(row).toHaveTextContent("Sky is a protocol, not a DAO");
    expect(row).toHaveTextContent("the atlas never calls it a DAO");
  });

  it("shows an 'open the source' link only when uuid is set, and routes clicks through onAtlas", () => {
    const onAtlas = vi.fn();
    render(
      <VerifyFindings
        verify={{
          ...base,
          contradictions: [
            { answer: "with a source", evidence: "e1", why: "r1", uuid: "u-1" },
            { answer: "without a source", evidence: "e2", why: "r2", uuid: null },
          ],
        }}
        onAtlas={onAtlas}
      />,
    );
    const links = screen.getAllByRole("link", { name: "open the source" });
    expect(links).toHaveLength(1);
    fireEvent.click(links[0]);
    expect(onAtlas).toHaveBeenCalledWith("u-1");
  });

  it("renders a ruling row when rulingIssued is set", () => {
    render(<VerifyFindings verify={{ ...base, rulingIssued: true }} onAtlas={noop} />);
    const row = screen.getByRole("listitem");
    expect(row).toHaveAttribute("data-status", "contradicted");
    expect(row).toHaveTextContent("the answer issues a ruling instead of reporting what the atlas says");
  });

  it("still renders the deterministic finding rows unchanged", () => {
    render(
      <VerifyFindings
        verify={{
          ...base,
          invalidCitations: ["11111111-1111-1111-1111-111111111111"],
          invalidDocNos: ["A.9.9"],
        }}
        onAtlas={noop}
      />,
    );
    expect(screen.getByText(/cites a document that does not exist/)).toBeInTheDocument();
    expect(screen.getByText(/document number does not exist in the atlas/)).toBeInTheDocument();
  });
});
