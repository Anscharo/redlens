// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ConceptCensusMembers } from "./ConceptCensusMembers";
import type { CensusMember } from "../../lib/conceptsCensus";

afterEach(cleanup);

const member = (over: Partial<CensusMember>): CensusMember => ({
  uuid: "id-A.9.1",
  doc_no: "A.9.1",
  title: "A Test Doc",
  ...over,
});

describe("ConceptCensusMembers", () => {
  it("renders a 'no members' message for an empty list", () => {
    render(<ConceptCensusMembers members={[]} />);
    expect(screen.getByText("no members")).toBeInTheDocument();
  });

  it("renders one row per member with a reader deep-link and the title", () => {
    render(
      <ConceptCensusMembers
        members={[member({}), member({ uuid: "id-A.9.2", doc_no: "A.9.2", title: "Second Doc" })]}
      />,
    );
    const first = screen.getByRole("link", { name: "A.9.1" });
    expect(first).toHaveAttribute("href", expect.stringContaining("id-A.9.1"));
    expect(screen.getByText("A Test Doc")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "A.9.2" })).toBeInTheDocument();
    expect(screen.getByText("Second Doc")).toBeInTheDocument();
  });

  it("renders the bucket pill only when the member carries a bucket label", () => {
    render(
      <ConceptCensusMembers members={[member({ bucket: "live" }), member({ uuid: "id-A.9.2", doc_no: "A.9.2" })]} />,
    );
    expect(screen.getByText("live")).toBeInTheDocument();
  });
});
