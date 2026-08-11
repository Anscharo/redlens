// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createRef } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Swatch } from "./Swatch";
import type { PaletteToken } from "./palette-tokens";

afterEach(() => cleanup());

const TOKEN: PaletteToken = { name: "bg", label: "Background", group: "surface", alpha: false };

describe("Swatch", () => {
  it("labels the button with the token label, name, and current value for a11y", () => {
    render(<Swatch token={TOKEN} value="#111111" isOverridden={false} onClick={() => {}} />);
    expect(
      screen.getByRole("button", { name: "Edit Background (--bg), currently #111111" }),
    ).toBeInTheDocument();
  });

  it("calls onClick when pressed", () => {
    const onClick = vi.fn();
    render(<Swatch token={TOKEN} value="#111111" isOverridden={false} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows no override marker and muted value text when not overridden", () => {
    render(<Swatch token={TOKEN} value="#111111" isOverridden={false} onClick={() => {}} />);
    expect(document.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(screen.getByTitle("--bg: #111111")).toHaveStyle({ color: "var(--tan-3)" });
  });

  it("shows an override dot and accent-colored value text when overridden", () => {
    render(<Swatch token={TOKEN} value="#222222" isOverridden onClick={() => {}} />);
    expect(document.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByTitle("--bg: #222222")).toHaveStyle({ color: "var(--accent)" });
  });

  it("omits the contrast badge when none is supplied", () => {
    render(<Swatch token={TOKEN} value="#111111" isOverridden={false} onClick={() => {}} />);
    expect(screen.queryByText(/Contrast:/)).toBeNull();
  });

  it("renders the contrast ratio and level when a badge is supplied", () => {
    render(
      <Swatch
        token={TOKEN}
        value="#111111"
        isOverridden={false}
        onClick={() => {}}
        contrastBadge={{ ratio: 12.345, level: "AAA" }}
      />,
    );
    expect(screen.getByText("Contrast: 12.3 AAA")).toBeInTheDocument();
  });

  it("abbreviates the 'AA Large' level to 'BB' in the badge text", () => {
    render(
      <Swatch
        token={TOKEN}
        value="#111111"
        isOverridden={false}
        onClick={() => {}}
        contrastBadge={{ ratio: 3.2, level: "AA Large" }}
      />,
    );
    expect(screen.getByText("Contrast: 3.2 BB")).toBeInTheDocument();
  });

  it("forwards a ref to the underlying button element", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Swatch ref={ref} token={TOKEN} value="#111111" isOverridden={false} onClick={() => {}} />);
    expect(ref.current).toBeInstanceOf(HTMLButtonElement);
  });
});
