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

  it("omits the fallback sentence for an Added doc (silent only applies to Changed)", () => {
    render(<PreviewChangeNotes source="pull request" hasPatch={false} status="Added" label="the live atlas" />);
    expect(screen.queryByText(/No visible difference/)).not.toBeInTheDocument();
  });
});
