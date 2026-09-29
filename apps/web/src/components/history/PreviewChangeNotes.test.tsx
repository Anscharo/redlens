// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PreviewChangeNotes } from "./PreviewChangeNotes";

afterEach(() => cleanup());

describe("PreviewChangeNotes", () => {
  it("shows the neutral fallback sentence with the given label for a silent Changed doc", () => {
    render(
      <PreviewChangeNotes source="pull request" hasPatch={false} status="Changed" label="the live atlas" />,
    );
    expect(screen.getByText("No visible difference from the live atlas.")).toBeInTheDocument();
  });

  it("names a repo base in the fallback sentence", () => {
    render(<PreviewChangeNotes source="pull request" hasPatch={false} status="Changed" label="acme/fork:main" />);
    expect(screen.getByText("No visible difference from acme/fork:main.")).toBeInTheDocument();
  });

  it("omits the fallback sentence once a patch is present, regardless of label", () => {
    render(<PreviewChangeNotes source="pull request" hasPatch status="Changed" label="acme/fork:main" />);
    expect(screen.queryByText(/No visible difference/)).not.toBeInTheDocument();
  });

  // The same rule as PreviewMark: ⚠ only where the displaced content was found.
  it("describes a swap with no relocation as rewritten, with no warning", () => {
    const swap = { oldTitle: "Operational GovOps", newTitle: "Sky Primitives" };
    const { container } = render(<PreviewChangeNotes swap={swap} source="pull request" hasPatch status="Changed" label="the live atlas" />);
    expect(container).toHaveTextContent("both the title and the body were replaced");
    expect(container).not.toHaveTextContent("Identity changed");
    expect(container).not.toHaveTextContent("⚠");
  });

  it("warns that the identity changed when the previous content was found elsewhere", () => {
    const swap = { oldTitle: "Operational GovOps", newTitle: "Sky Primitives", movedTo: { id: "y", doc_no: "A.6.1.2.2.2.1", title: "Soter Labs" } };
    const { container } = render(<PreviewChangeNotes swap={swap} source="pull request" hasPatch status="Changed" label="the live atlas" />);
    expect(container).toHaveTextContent("⚠ Identity changed");
    expect(container).toHaveTextContent("moved to A.6.1.2.2.2.1");
  });

  it("omits the fallback sentence for an Added doc (silent only applies to Changed)", () => {
    render(<PreviewChangeNotes source="pull request" hasPatch={false} status="Added" label="the live atlas" />);
    expect(screen.queryByText(/No visible difference/)).not.toBeInTheDocument();
  });
});
