// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Address } from "./Address";
import { resetSharedBalances } from "../lib/sharedBalances";

const ADDR = "0xae7ab96520de3a18e5e111b5eaab095312d7fe84";

const loadBalancesCached = vi.fn();
vi.mock("@/lib/balances", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadBalancesCached: () => loadBalancesCached(),
  peekCachedBalances: () => null,
}));

beforeEach(() => {
  // Leave the fetch pending so teaser mounts don't settle a store update
  // (and trip act(...) warnings) in tests that only care about the pill.
  loadBalancesCached.mockReset();
  loadBalancesCached.mockReturnValue(new Promise(() => {}));
  resetSharedBalances();
});
afterEach(cleanup);

describe("Address", () => {
  it("renders a new-tab explorer link with a chain-correct href", () => {
    render(<Address address={ADDR} chain="base" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", `https://basescan.org/address/${ADDR}`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("title", ADDR);
  });

  it("shortens the address by default and shows it in full with `full`", () => {
    const { rerender } = render(<Address address={ADDR} />);
    expect(screen.getByRole("link")).toHaveTextContent("0xae7a…fe84");
    rerender(<Address address={ADDR} full />);
    expect(screen.getByRole("link")).toHaveTextContent(ADDR);
  });

  it("lets children override the displayed content", () => {
    render(
      <Address address={ADDR}>
        <span>MCD_VAT · 0xae7a…fe84</span>
      </Address>,
    );
    expect(screen.getByRole("link")).toHaveTextContent("MCD_VAT · 0xae7a…fe84");
  });

  it("fires the caller's onClick alongside its own analytics", () => {
    const onClick = vi.fn();
    render(<Address address={ADDR} onClick={onClick} />);
    fireEvent.click(screen.getByRole("link"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("lets the caller extend the base className", () => {
    render(<Address address={ADDR} className="text-xs" />);
    const link = screen.getByRole("link");
    expect(link.className).toContain("text-xs");
    expect(link.className).toContain("rl-addr");
  });

  it("shows the hover-affordance icon when the tooltip is active, and hides it with noTooltip", () => {
    const { container, rerender } = render(<Address address={ADDR} />);
    expect(container.querySelector(".rl-addr-hint")).not.toBeNull();
    rerender(<Address address={ADDR} noTooltip />);
    expect(container.querySelector(".rl-addr-hint")).toBeNull();
  });

  it("noHint hides the icon while keeping the tooltip", () => {
    const { container } = render(<Address address={ADDR} noHint />);
    expect(container.querySelector(".rl-addr-hint")).toBeNull();
    // still wrapped for hover (tooltip trigger present as the anchor)
    expect(container.querySelector("a.rl-addr")).not.toBeNull();
  });

  it("renders a text-only pill inline (rl-addr-plain) so it selects/copies like prose", () => {
    // no balance + no hint → text-only → inline display for natural selection
    const { container } = render(<Address address={ADDR} full noBalance noHint />);
    const link = container.querySelector("a.rl-addr")!;
    expect(link.classList.contains("rl-addr-plain")).toBe(true);
    expect(link.querySelector(".rl-addr-bal")).toBeNull();
    expect(link.querySelector(".rl-addr-hint")).toBeNull();
    expect(link.textContent).toBe(ADDR); // nothing extra to copy
  });

  it("does not fetch balances for a noBalance pill (prose)", () => {
    render(<Address address={ADDR} full noBalance noHint />);
    expect(loadBalancesCached).not.toHaveBeenCalled();
  });

  it("fetches balances on mount for a teaser pill", () => {
    render(<Address address={ADDR} />);
    expect(loadBalancesCached).toHaveBeenCalledTimes(1);
  });

  it("forwards onMouseEnter through the tooltip wrapper instead of dropping it", () => {
    const onMouseEnter = vi.fn();
    render(<Address address={ADDR} onMouseEnter={onMouseEnter} />);
    fireEvent.mouseEnter(screen.getByRole("link"));
    expect(onMouseEnter).toHaveBeenCalledTimes(1);
  });
});
