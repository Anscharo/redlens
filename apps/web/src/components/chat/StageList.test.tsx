// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StageList, traceHeadline } from "./StageList";
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

  it("maps known stages to their user-facing label — done rows in the simple past, the active (last) row present continuous", () => {
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
    for (const label of ["Recalled context", "Looked for evidence", "Compared results", "Synthesized"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // checking is the last (active) entry — still present continuous.
    expect(screen.getByText("Verifying content")).toBeInTheDocument();
  });

  it("strips a trailing ellipsis from a done row's detail but leaves the active row's detail untouched", () => {
    render(
      <StageList
        entries={[
          { stage: "querying", details: ["Searching the atlas…"], at: 0, round: 1 },
          { stage: "synthesizing", details: ["Writing an answer from the evidence..."], at: 1, round: 1 },
        ]}
        collapsed={false}
        summary=""
        renderSlot={noSlot}
      />,
    );
    // querying (done) — ellipsis (either form) stripped.
    expect(screen.getByText("Searching the atlas")).toBeInTheDocument();
    expect(screen.queryByText("Searching the atlas…")).toBeNull();
    // synthesizing (active, the last entry) — copy is untouched.
    expect(screen.getByText("Writing an answer from the evidence...")).toBeInTheDocument();
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

  it("no row is active once collapsed, even the last one, but their detail lines stay visible when expanded — with the trailing ellipsis stripped now that they read as done", () => {
    const { container } = render(
      <StageList
        entries={[
          { stage: "querying", details: ["Searching…"], at: 0, round: 1 },
          { stage: "checking", details: ["Auditing…"], at: 1, round: 1 },
        ]}
        collapsed
        summary="atlas lookups and reasoning"
        renderSlot={noSlot}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /atlas lookups and reasoning/ }));
    const rows = container.querySelectorAll("li.rlc-stage");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.getAttribute("data-state")).toBe("done");
    }
    expect(screen.getByText("Searching")).toBeInTheDocument();
    expect(screen.getByText("Auditing")).toBeInTheDocument();
    expect(screen.queryByText("Searching…")).toBeNull();
    expect(screen.queryByText("Auditing…")).toBeNull();
    // A finished/collapsed list reads entirely in the simple past, even the
    // row that was last (querying's "Looking for evidence" never appears).
    expect(screen.getByText("Looked for evidence")).toBeInTheDocument();
    expect(screen.getByText("Verified content")).toBeInTheDocument();
    expect(screen.queryByText("Looking for evidence")).toBeNull();
    expect(screen.queryByText("Verifying content")).toBeNull();
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
    // querying (at 0) is not the last/active entry here — checking is — so
    // it renders in the done (simple past) tense.
    fireEvent.click(screen.getByRole("button", { name: /Looked for evidence/ }));
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

  it("keeps the tree (and the open row) when the turn finishes with a row open, flipping its label to the done tense", () => {
    const entries = [{ stage: "synthesizing", details: [], at: 5, round: 1 }];
    const slot = () => <span>the draft</span>;
    const { rerender } = render(<StageList entries={entries} collapsed={false} summary="s" renderSlot={slot} />);
    fireEvent.click(screen.getByRole("button", { name: /Synthesizing/ }));
    expect(screen.getByText("the draft")).toBeInTheDocument();
    rerender(<StageList entries={entries} collapsed={true} summary="s" renderSlot={slot} />);
    expect(screen.getByText("the draft")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Answer progress" })).toBeInTheDocument();
    expect(screen.getByText("Synthesized")).toBeInTheDocument();
    // The row itself still folds on a second click.
    fireEvent.click(screen.getByRole("button", { name: /Synthesized/ }));
    expect(screen.queryByText("the draft")).not.toBeInTheDocument();
  });

  it("keeps the full tree, with no summary head, when a list that mounted live finishes — its row now reads in the done tense", () => {
    const entries = [{ stage: "querying", details: ["Searching…"], at: 0, round: 1 }];
    const { rerender } = render(<StageList entries={entries} collapsed={false} summary="s" renderSlot={noSlot} />);
    rerender(<StageList entries={entries} collapsed={true} summary="s" renderSlot={noSlot} />);
    expect(screen.getByText("Looked for evidence")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^s$/ })).toBeNull();
    expect(document.querySelector("li.rlc-stage")?.getAttribute("data-state")).toBe("done");
  });

  it("marks the row whose `at` matches activeAt as active, not the list's last row", () => {
    const entries = [
      { stage: "querying", details: [], at: 0, round: 1 },
      { stage: "synthesizing", details: [], at: 1, round: 1 },
    ];
    const { container } = render(<StageList entries={entries} collapsed={false} summary="s" activeAt={7} renderSlot={noSlot} />);
    for (const row of container.querySelectorAll("li.rlc-stage")) expect(row.getAttribute("data-state")).toBe("done");
  });

  it("shows a collapsed one-line summary instead of the tree when collapsed", () => {
    const { container } = render(
      <StageList
        entries={[{ stage: "querying", details: [], at: 0, round: 1 }]}
        collapsed
        summary="atlas lookups and reasoning"
        renderSlot={noSlot}
      />,
    );
    expect(container.querySelector("ol.rlc-stages")).toBeNull();
    const head = screen.getByRole("button", { name: /atlas lookups and reasoning/ });
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(head).toHaveAttribute("aria-controls");
    expect(document.getElementById(head.getAttribute("aria-controls")!)).toBeNull();
  });

  it("expands the collapsed summary into the full tree on click, its row already in the done tense", () => {
    render(
      <StageList
        entries={[{ stage: "querying", details: ["Searching…"], at: 0, round: 1 }]}
        collapsed
        summary="atlas lookups and reasoning"
        renderSlot={noSlot}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /atlas lookups and reasoning/ }));
    expect(screen.getByText("Looked for evidence")).toBeInTheDocument();
    const head = screen.getByRole("button", { name: /atlas lookups and reasoning/ });
    expect(head).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(head.getAttribute("aria-controls")!)).toHaveClass("rlc-stages");
  });
});

describe("traceHeadline", () => {
  it("names recall alone on a facts-only turn", () => {
    const trace: TraceRow[] = [{ name: "features", args: {}, ok: true, bytes: null, kind: "fact", summary: "the app's features guide", round: 0 }];
    expect(traceHeadline(trace)).toBe("recall and reasoning");
  });

  it("names lookups alone on a tools-only turn, with no count however many there were", () => {
    const trace: TraceRow[] = [
      { name: "atlas_query", args: {}, ok: true, bytes: 5, round: 1 },
      { name: "atlas_get", args: {}, ok: false, bytes: null, round: 1 },
    ];
    expect(traceHeadline(trace)).toBe("atlas lookups and reasoning");
  });

  it("names both when a turn has both", () => {
    const trace: TraceRow[] = [
      { name: "glossary", args: {}, ok: true, bytes: null, kind: "fact", summary: "2 glossary definitions", round: 0 },
      { name: "atlas_get", args: {}, ok: true, bytes: 5, round: 1 },
    ];
    expect(traceHeadline(trace)).toBe("recall, atlas lookups and reasoning");
  });

  it("falls back to plain reasoning for an empty trace — the head must never be blank", () => {
    expect(traceHeadline([])).toBe("reasoning");
  });
});

describe("StageList / list name", () => {
  const entries = [{ stage: "querying", details: [], at: 0, round: 1 }];

  it("names the list 'Answer progress' by default", () => {
    render(<StageList entries={entries} collapsed={false} summary="s" renderSlot={noSlot} />);
    expect(screen.getByRole("list", { name: "Answer progress" })).toBeInTheDocument();
  });

  // A turn renders two StageLists (Message.tsx); sharing one name leaves a
  // screen-reader user unable to tell them apart.
  it("uses a caller's name instead, so the two lists in one turn are distinguishable", () => {
    render(<StageList entries={entries} collapsed={false} summary="s" label="Answer checks" renderSlot={noSlot} />);
    expect(screen.getByRole("list", { name: "Answer checks" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Answer progress" })).toBeNull();
  });
});
