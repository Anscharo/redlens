// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StageList, traceHeadline, things } from "./StageList";
import type { TraceRow } from "./useChatStream";

afterEach(cleanup);

const noSlot = () => null;

describe("StageList", () => {
  it("renders one <li> per stageLog entry inside a semantic <ol> when not collapsed", () => {
    const { container } = render(
      <StageList
        entries={[
          { stage: "querying", details: ["Searching…"], at: 0, round: 1 },
          { stage: "checking", details: ["Auditing…"], at: 1, round: 1 },
        ]}
        collapsed={false}
        summary=""
        renderSlot={noSlot}
      />,
    );
    expect(container.querySelector("ol.rlc-stages")).toBeInTheDocument();
    expect(container.querySelectorAll("li.rlc-stage")).toHaveLength(2);
  });

  it("maps known stages to their user-facing label", () => {
    render(
      <StageList
        entries={[
          { stage: "recalling", details: [], at: 0, round: 0 },
          { stage: "querying", details: [], at: 1, round: 1 },
          { stage: "comparing", details: [], at: 2, round: 1 },
          { stage: "synthesizing", details: [], at: 3, round: 1 },
          { stage: "checking", details: [], at: 4, round: 1 },
        ]}
        collapsed={false}
        summary=""
        renderSlot={noSlot}
      />,
    );
    for (const label of ["Recalling context", "Looking for evidence", "Comparing results", "Synthesizing", "Verifying content"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("capitalizes an unrecognized stage's raw name", () => {
    render(
      <StageList
        entries={[{ stage: "escalating", details: [], at: 0, round: 0 }]}
        collapsed={false}
        summary=""
        renderSlot={noSlot}
      />,
    );
    expect(screen.getByText("Escalating")).toBeInTheDocument();
  });

  it("marks only the last row active, but keeps a done row's detail visible — nothing shown ever disappears", () => {
    const { container } = render(
      <StageList
        entries={[
          { stage: "querying", details: ["first detail"], at: 0, round: 1 },
          { stage: "checking", details: ["second detail"], at: 1, round: 1 },
        ]}
        collapsed={false}
        summary=""
        renderSlot={noSlot}
      />,
    );
    const rows = container.querySelectorAll("li.rlc-stage");
    expect(rows[0].getAttribute("data-state")).toBe("done");
    expect(rows[1].getAttribute("data-state")).toBe("active");
    expect(screen.getByText("first detail")).toBeInTheDocument();
    expect(screen.getByText("second detail")).toBeInTheDocument();
  });

  it("renders three stacked detail lines for a row with three details, in arrival order", () => {
    render(
      <StageList
        entries={[{ stage: "querying", details: ["one", "two", "three"], at: 0, round: 1 }]}
        collapsed={false}
        summary=""
        renderSlot={noSlot}
      />,
    );
    const lines = screen.getAllByText(/^(one|two|three)$/).map((el) => el.textContent);
    expect(lines).toEqual(["one", "two", "three"]);
  });

  it("omits the detail line for the active row when detail is null", () => {
    const { container } = render(
      <StageList
        entries={[{ stage: "synthesizing", details: [], at: 0, round: 1 }]}
        collapsed={false}
        summary=""
        renderSlot={noSlot}
      />,
    );
    expect(container.querySelector(".rlc-stage-detail")).toBeNull();
  });

  it("stamps data-round from the entry", () => {
    const { container } = render(
      <StageList
        entries={[{ stage: "querying", details: [], at: 0, round: 2 }]}
        collapsed={false}
        summary=""
        renderSlot={noSlot}
      />,
    );
    expect(container.querySelector("li.rlc-stage")).toHaveAttribute("data-round", "2");
  });

  it("no row is active once collapsed, even the last one, but their detail lines stay visible when expanded", () => {
    const { container } = render(
      <StageList
        entries={[
          { stage: "querying", details: ["Searching…"], at: 0, round: 1 },
          { stage: "checking", details: ["Auditing…"], at: 1, round: 1 },
        ]}
        collapsed
        summary="looked up 2 things over the atlas"
        renderSlot={noSlot}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /looked up 2 things over the atlas/ }));
    const rows = container.querySelectorAll("li.rlc-stage");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.getAttribute("data-state")).toBe("done");
    }
    expect(screen.getByText("Searching…")).toBeInTheDocument();
    expect(screen.getByText("Auditing…")).toBeInTheDocument();
  });

  it("renders a row with no toggle affordance (plain, not a button) when renderSlot returns null", () => {
    const { container } = render(
      <StageList
        entries={[{ stage: "querying", details: [], at: 0, round: 1 }]}
        collapsed={false}
        summary=""
        renderSlot={() => null}
      />,
    );
    expect(container.querySelector("li.rlc-stage button")).toBeNull();
  });

  it("renders the row as a disclosure button when renderSlot returns non-null content", () => {
    render(
      <StageList
        entries={[{ stage: "querying", details: [], at: 0, round: 1 }]}
        collapsed={false}
        summary=""
        renderSlot={() => <span>slot content</span>}
      />,
    );
    expect(screen.getByRole("button", { name: /Looking for evidence/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps a row's slot hidden until its own row is clicked", () => {
    render(
      <StageList
        entries={[{ stage: "querying", details: [], at: 0, round: 1 }]}
        collapsed={false}
        summary=""
        renderSlot={() => <span>slot content</span>}
      />,
    );
    expect(screen.queryByText("slot content")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Looking for evidence/ }));
    expect(screen.getByText("slot content")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Looking for evidence/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("collapses a row's slot again on a second click of the same row", () => {
    render(
      <StageList
        entries={[{ stage: "querying", details: [], at: 0, round: 1 }]}
        collapsed={false}
        summary=""
        renderSlot={() => <span>slot content</span>}
      />,
    );
    const toggle = screen.getByRole("button", { name: /Looking for evidence/ });
    fireEvent.click(toggle);
    expect(screen.getByText("slot content")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByText("slot content")).toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("toggles each row independently — opening one does not open the other", () => {
    render(
      <StageList
        entries={[
          { stage: "querying", details: [], at: 0, round: 1 },
          { stage: "checking", details: [], at: 1, round: 1 },
        ]}
        collapsed={false}
        summary=""
        renderSlot={(entry) => <span>{entry.stage} slot</span>}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Looking for evidence/ }));
    expect(screen.getByText("querying slot")).toBeInTheDocument();
    expect(screen.queryByText("checking slot")).toBeNull();
  });

  // Regression: the slot used to render inside the row's own toggle
  // <button>, so a nested interactive element in the slot both produced
  // invalid <button><button> nesting and had its click bubble up to the
  // outer toggle, collapsing the row. The slot must be a sibling of the
  // toggle button in the DOM, never a descendant of it.
  it("does not nest the slot's own controls inside the row toggle button, and a click inside the slot does not collapse the row", () => {
    const { container } = render(
      <StageList
        entries={[{ stage: "querying", details: [], at: 0, round: 1 }]}
        collapsed={false}
        summary=""
        renderSlot={() => <button type="button">inner control</button>}
      />,
    );
    const rowToggle = screen.getByRole("button", { name: /Looking for evidence/ });
    fireEvent.click(rowToggle);
    const innerControl = screen.getByRole("button", { name: "inner control" });
    expect(rowToggle.contains(innerControl)).toBe(false);
    expect(container.querySelector("button button")).toBeNull();

    fireEvent.click(innerControl);
    expect(rowToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("inner control")).toBeInTheDocument();
  });

  it("shows a collapsed one-line summary instead of the tree when collapsed", () => {
    const { container } = render(
      <StageList
        entries={[{ stage: "querying", details: [], at: 0, round: 1 }]}
        collapsed
        summary="looked up 2 things over the atlas"
        renderSlot={noSlot}
      />,
    );
    expect(container.querySelector("ol.rlc-stages")).toBeNull();
    const head = screen.getByRole("button", { name: /looked up 2 things over the atlas/ });
    expect(head).toHaveAttribute("aria-expanded", "false");
  });

  it("expands the collapsed summary into the full tree on click", () => {
    render(
      <StageList
        entries={[{ stage: "querying", details: ["Searching…"], at: 0, round: 1 }]}
        collapsed
        summary="looked up 1 thing over the atlas"
        renderSlot={noSlot}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /looked up 1 thing over the atlas/ }));
    expect(screen.getByText("Looking for evidence")).toBeInTheDocument();
  });
});

describe("traceHeadline", () => {
  it("says only what happened on a facts-only turn", () => {
    const trace: TraceRow[] = [{ name: "features", args: {}, ok: true, bytes: null, kind: "fact", summary: "the app's features guide", round: 0 }];
    expect(traceHeadline(trace)).toBe("recalled 1 thing");
  });

  it("uses plural phrasing for multiple lookups", () => {
    const trace: TraceRow[] = [
      { name: "atlas_query", args: {}, ok: true, bytes: 5, round: 1 },
      { name: "atlas_get", args: {}, ok: false, bytes: null, round: 1 },
    ];
    expect(traceHeadline(trace)).toBe("looked up 2 things over the atlas");
  });

  it("combines recalled and looked-up when a turn has both", () => {
    const trace: TraceRow[] = [
      { name: "glossary", args: {}, ok: true, bytes: null, kind: "fact", summary: "2 glossary definitions", round: 0 },
      { name: "atlas_get", args: {}, ok: true, bytes: 5, round: 1 },
    ];
    expect(traceHeadline(trace)).toBe("recalled 1 thing · looked up 1 thing over the atlas");
  });

  it("returns an empty string for an empty trace", () => {
    expect(traceHeadline([])).toBe("");
  });
});

describe("things", () => {
  it("pluralizes correctly", () => {
    expect(things(1)).toBe("1 thing");
    expect(things(2)).toBe("2 things");
    expect(things(0)).toBe("0 things");
  });
});
