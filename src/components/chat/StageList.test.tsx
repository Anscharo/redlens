// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StageList } from "./StageList";

afterEach(cleanup);

describe("StageList", () => {
  it("renders one <li> per stageLog entry inside a semantic <ol>", () => {
    const { container } = render(
      <StageList
        entries={[
          { stage: "querying", detail: "Searching…", at: 0 },
          { stage: "checking", detail: "Auditing…", at: 1 },
        ]}
      />,
    );
    expect(container.querySelector("ol.rlc-stages")).toBeInTheDocument();
    expect(container.querySelectorAll("li.rlc-stage")).toHaveLength(2);
  });

  it("maps known stages to their user-facing label", () => {
    render(
      <StageList
        entries={[
          { stage: "recalling", detail: null, at: 0 },
          { stage: "querying", detail: null, at: 1 },
          { stage: "reading", detail: null, at: 2 },
          { stage: "comparing", detail: null, at: 3 },
          { stage: "synthesizing", detail: null, at: 4 },
          { stage: "checking", detail: null, at: 5 },
          { stage: "advising", detail: null, at: 6 },
          { stage: "revising", detail: null, at: 7 },
          { stage: "finalizing", detail: null, at: 8 },
        ]}
      />,
    );
    for (const label of [
      "Recalling context",
      "Looking for evidence",
      "Reading documents",
      "Comparing results",
      "Synthesizing",
      "Verifying content",
      "Seeking advice",
      "Revising claims",
      "Preparing final report",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("capitalizes an unrecognized stage's raw name", () => {
    render(<StageList entries={[{ stage: "escalating", detail: null, at: 0 }]} />);
    expect(screen.getByText("Escalating")).toBeInTheDocument();
  });

  it("marks only the last row active and shows its detail; earlier rows are done with no detail", () => {
    const { container } = render(
      <StageList
        entries={[
          { stage: "querying", detail: "first detail", at: 0 },
          { stage: "checking", detail: "second detail", at: 1 },
        ]}
      />,
    );
    const rows = container.querySelectorAll("li.rlc-stage");
    expect(rows[0].getAttribute("data-state")).toBe("done");
    expect(rows[1].getAttribute("data-state")).toBe("active");
    expect(screen.queryByText("first detail")).toBeNull();
    expect(screen.getByText("second detail")).toBeInTheDocument();
  });

  it("omits the detail line for the active row when detail is null", () => {
    const { container } = render(<StageList entries={[{ stage: "synthesizing", detail: null, at: 0 }]} />);
    expect(container.querySelector(".rlc-stage-detail")).toBeNull();
  });
});
