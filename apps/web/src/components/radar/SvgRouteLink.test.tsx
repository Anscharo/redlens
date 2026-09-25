// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { SvgRouteLink } from "./SvgRouteLink";

afterEach(cleanup);

function wrap(path = "/") {
  const { hook } = memoryLocation({ path, record: true });
  return ({ children }: { children: React.ReactNode }) => <Router hook={hook}>{children}</Router>;
}

function LocationProbe() {
  const [loc] = useLocation();
  return <p>current: {loc}</p>;
}

function renderLink(ui: React.ReactNode, path = "/") {
  const Wrapper = wrap(path);
  return render(
    <Wrapper>
      <svg>{ui}</svg>
      <LocationProbe />
    </Wrapper>,
  );
}

describe("SvgRouteLink", () => {
  it("renders an SVG anchor with the resolved href and accessible name", () => {
    renderLink(
      <SvgRouteLink to="/radar/spark/settlements" label="Spark">
        <text>Spark</text>
      </SvgRouteLink>,
    );
    const a = screen.getByRole("link", { name: "Spark" });
    expect(a).toHaveAttribute("href", "/radar/spark/settlements");
  });

  it("navigates in-SPA on a plain left click", () => {
    renderLink(
      <SvgRouteLink to="/radar/spark/settlements" label="Spark">
        <text>Spark</text>
      </SvgRouteLink>,
    );
    expect(screen.getByText("current: /")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Spark" }), { button: 0 });
    expect(screen.getByText("current: /radar/spark/settlements")).toBeInTheDocument();
  });

  it("does not navigate when a modifier key is held", () => {
    renderLink(
      <SvgRouteLink to="/radar/spark/settlements" label="Spark">
        <text>Spark</text>
      </SvgRouteLink>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Spark" }), { button: 0, metaKey: true });
    expect(screen.getByText("current: /")).toBeInTheDocument();
  });

  it("calls a user-supplied onClick before deciding to navigate", () => {
    const onClick = vi.fn();
    renderLink(
      <SvgRouteLink to="/radar/spark/settlements" label="Spark" onClick={onClick}>
        <text>Spark</text>
      </SvgRouteLink>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Spark" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("respects a user handler that calls preventDefault (no navigation)", () => {
    renderLink(
      <SvgRouteLink to="/radar/spark/settlements" label="Spark" onClick={(e) => e.preventDefault()}>
        <text>Spark</text>
      </SvgRouteLink>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Spark" }));
    expect(screen.getByText("current: /")).toBeInTheDocument();
  });

  it("spreads remaining native props last so className and data-* land on the anchor", () => {
    renderLink(
      <SvgRouteLink to="/radar" label="Overview" className="msc-sankey-sink-link" data-prime="spark">
        <text>Sky</text>
      </SvgRouteLink>,
    );
    const a = screen.getByRole("link", { name: "Overview" });
    expect(a).toHaveClass("msc-sankey-sink-link");
    expect(a).toHaveAttribute("data-prime", "spark");
  });
});
