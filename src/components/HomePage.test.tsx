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

  it("renders either the Reports card or the Preview card depending on the build flag", () => {
    render(<HomePage />, { wrapper: wrap() });
    const reportsLink = screen.queryByRole("link", { name: /Reports/ });
    const previewLink = screen.queryByRole("link", { name: /Preview/ });
    // Exactly one of the two mutually exclusive fourth cards renders.
    expect(Boolean(reportsLink) !== Boolean(previewLink)).toBe(true);
  });

  it("renders the Library card as an in-SPA link to the reports/library route", () => {
    render(<HomePage />, { wrapper: wrap() });
    expect(screen.getByRole("link", { name: /Library/ })).toHaveAttribute("href", "/reports/library");
  });

  it("renders the patch notes section", () => {
    render(<HomePage />, { wrapper: wrap() });
    expect(screen.getByRole("heading", { name: "Recent improvements" })).toBeInTheDocument();
  });
});
