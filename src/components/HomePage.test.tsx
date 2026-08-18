// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { HomePage } from "./HomePage";

afterEach(() => {
  cleanup();
});

function wrap(path = "/") {
  const { hook } = memoryLocation({ path, record: true });
  return ({ children }: { children: React.ReactNode }) => <Router hook={hook}>{children}</Router>;
}

describe("HomePage", () => {
  it("renders the hero heading and intro copy", () => {
    render(<HomePage />, { wrapper: wrap() });
    expect(screen.getByRole("heading", { level: 1, name: "Sky Atlas by Redline" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sky Atlas" })).toHaveAttribute(
      "href",
      "https://github.com/sky-ecosystem/next-gen-atlas",
    );
    expect(screen.getByRole("link", { name: "Sky protocol" })).toHaveAttribute("href", "https://sky.money");
  });

  it("renders the Reader, Radar, and Connect (MCP) cards with in-SPA links", () => {
    render(<HomePage />, { wrapper: wrap() });
    expect(screen.getByRole("link", { name: /Reader/ })).toHaveAttribute("href", "/atlas");
    expect(screen.getByRole("link", { name: /Radar/ })).toHaveAttribute("href", "/radar");
    expect(screen.getByRole("link", { name: /Connect \(MCP\)/ })).toHaveAttribute("href", "/connect");
  });

  it("renders both the Preview and Reports cards", () => {
    render(<HomePage />, { wrapper: wrap() });
    // Preview mounts its own shell, so its card is a plain anchor, not a wouter Link.
    expect(screen.getByRole("link", { name: /Preview/ })).toHaveAttribute("href", "/preview");
    expect(screen.getByRole("link", { name: /Reports/ })).toHaveAttribute("href", "/reports");
  });

  it("renders the CrossView card as an in-SPA link to the reports/crossview route", () => {
    render(<HomePage />, { wrapper: wrap() });
    expect(screen.getByRole("link", { name: /CrossView/ })).toHaveAttribute("href", "/reports/crossview");
  });

  it("renders the features banner ABOVE the cards — it's the first-time reader's entry point", () => {
    render(<HomePage />, { wrapper: wrap() });
    const banner = screen.getByRole("link", { name: /New here\? See everything you can do/ });
    expect(banner).toHaveAttribute("href", "/features");
    // Order matters: the banner has to precede the first card in the document,
    // otherwise it sits below the grid where a newcomer never reaches it.
    const firstCard = screen.getByRole("link", { name: /Reader/ });
    expect(banner.compareDocumentPosition(firstCard)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("renders the patch notes section", () => {
    render(<HomePage />, { wrapper: wrap() });
    expect(screen.getByRole("heading", { name: "Recent improvements" })).toBeInTheDocument();
  });
});
