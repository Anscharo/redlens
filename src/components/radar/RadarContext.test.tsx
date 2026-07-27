// @vitest-environment jsdom

import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { RadarProvider, useRadar } from "./RadarContext";
import type { AtlasNode } from "../../types";

afterEach(cleanup);

function Consumer() {
  const { docs } = useRadar();
  return <div data-testid="doc-count">{Object.keys(docs).length}</div>;
}

describe("RadarProvider / useRadar", () => {
  it("provides docs to a consumer inside the provider", () => {
    const docs = { "uuid-1": {} as AtlasNode, "uuid-2": {} as AtlasNode };
    render(
      <RadarProvider value={{ docs }}>
        <Consumer />
      </RadarProvider>,
    );
    expect(screen.getByTestId("doc-count")).toHaveTextContent("2");
  });

  it("throws when useRadar is called outside a provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Consumer />)).toThrow("useRadar must be used inside <RadarProvider>");
    spy.mockRestore();
  });
});
