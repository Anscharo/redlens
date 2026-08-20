// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AgentChips, DocCell } from "./OGReportParts";
import { parseReportQuery } from "@/lib/reportFilter";
import type { Chain } from "@/lib/reportChains";

afterEach(cleanup);

const chain = (agentId: string): Chain => ({
  agentId,
  executorName: "Exec",
  executorId: "exec-id",
  govopsName: "Gov",
  govopsId: "gov-id",
  facilitatorName: "Fac",
  facilitatorId: "fac-id",
});

describe("AgentChips", () => {
  it("returns null for an empty agent list", () => {
    const { container } = render(<AgentChips agents={[]} chains={new Map()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links a chip when the agent has a known chain", () => {
    const chains = new Map([["Amatsu", chain("amatsu-uuid")]]);
    render(<AgentChips agents={["Amatsu"]} chains={chains} />);
    const link = screen.getByRole("link", { name: "Amatsu" });
    expect(link).toHaveAttribute("href", "/atlas?id=amatsu-uuid");
  });

  it("renders a plain span (no link) when the agent has no chain entry", () => {
    render(<AgentChips agents={["Unknown Agent"]} chains={new Map()} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Unknown Agent")).toBeInTheDocument();
  });

  it("highlights matches via the report query", () => {
    render(<AgentChips agents={["Amatsu"]} chains={new Map()} rq={parseReportQuery("mats")} />);
    expect(screen.getByText("mats", { selector: "mark.q-mark" })).toBeInTheDocument();
  });
});

describe("DocCell", () => {
  it("renders a plain span when the row has no uuid", () => {
    render(<DocCell r={{ uuid: "", docNo: "A.1" }} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("A.1")).toBeInTheDocument();
  });

  it("renders a single link when there's one source (or none)", () => {
    render(<DocCell r={{ uuid: "u1", docNo: "A.1" }} />);
    const link = screen.getByRole("link", { name: "A.1" });
    expect(link).toHaveAttribute("href", "/atlas?id=u1");
  });

  it("renders one link per source, with agent as title + aria-label, when merged", () => {
    render(
      <DocCell
        r={{
          uuid: "u1",
          docNo: "A.1",
          sources: [
            { uuid: "u1", docNo: "A.1", agent: "Amatsu" },
            { uuid: "u2", docNo: "A.2", agent: "Keel" },
          ],
        }}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/atlas?id=u1");
    expect(links[0]).toHaveAttribute("title", "Amatsu");
    expect(links[0]).toHaveAttribute("aria-label", "A.1 — Amatsu");
    expect(links[1]).toHaveAttribute("href", "/atlas?id=u2");
  });

  it("treats a single-element sources array like the representative-only case", () => {
    render(<DocCell r={{ uuid: "u1", docNo: "A.1", sources: [{ uuid: "u1", docNo: "A.1" }] }} />);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
