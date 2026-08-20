// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { AdminPage } from "./AdminPage";

afterEach(() => cleanup());

function wrap(path = "/admin") {
  const { hook } = memoryLocation({ path, record: true });
  return ({ children }: { children: React.ReactNode }) => <Router hook={hook}>{children}</Router>;
}

function LocationProbe() {
  const [loc] = useLocation();
  return <p>current: {loc}</p>;
}

describe("AdminPage", () => {
  it("links to the palette editor", () => {
    render(<AdminPage />, { wrapper: wrap() });
    expect(screen.getByRole("link", { name: /Palette/ })).toHaveAttribute("href", "/admin/palette");
  });

  it("navigates to /admin/palette on click", () => {
    const Wrapper = wrap();
    render(
      <Wrapper>
        <AdminPage />
        <LocationProbe />
      </Wrapper>,
    );
    fireEvent.click(screen.getByRole("link", { name: /Palette/ }));
    expect(screen.getByText("current: /admin/palette")).toBeInTheDocument();
  });
});
