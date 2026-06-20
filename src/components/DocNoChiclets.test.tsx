// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { DocNoChiclets } from "./DocNoChiclets";

afterEach(cleanup);

describe("DocNoChiclets", () => {
  it("renders one chiclet span per part with the correct text and --c custom property", () => {
    const { container } = render(<DocNoChiclets parts={["A", "1", "2"]} depths={[1, 2, 3]} />);
    const chiclets = container.querySelectorAll(".atlas-chiclet");
    expect(chiclets).toHaveLength(3);
    expect(chiclets[0].textContent).toBe("A");
    expect((chiclets[0] as HTMLElement).style.getPropertyValue("--c")).toBe("var(--depth-1)");
    expect(chiclets[1].textContent).toBe("1");
    expect((chiclets[1] as HTMLElement).style.getPropertyValue("--c")).toBe("var(--depth-2)");
    expect(chiclets[2].textContent).toBe("2");
    expect((chiclets[2] as HTMLElement).style.getPropertyValue("--c")).toBe("var(--depth-3)");
  });

  it("uses var(--tan-2) for depth 0 (matches reader title color)", () => {
    const { container } = render(<DocNoChiclets parts={["A"]} depths={[0]} />);
    const chiclet = container.querySelector(".atlas-chiclet") as HTMLElement;
    expect(chiclet.style.getPropertyValue("--c")).toBe("var(--tan-2)");
  });
});
