// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { CrossViewTopicIndex } from "./CrossViewTopicIndex";
import { parseCrossViewIndex } from "../../lib/crossviewIndex";
import { extractHeadings } from "../../lib/crossviewHeadings";
import conceptsRaw from "../../../../../docs/crossview/concepts.md?raw";

afterEach(cleanup);

describe("CrossViewTopicIndex", () => {
  it("renders a 'Topics' nav landmark with one row per parsed II.7 entry, alphabetically sorted", () => {
    render(<CrossViewTopicIndex />);
    const nav = screen.getByRole("navigation", { name: "Topics" });
    expect(nav).toHaveTextContent("Topics");

    const headings = extractHeadings(conceptsRaw);
    const entries = parseCrossViewIndex(conceptsRaw, headings);
    const items = nav.querySelectorAll("li");
    expect(items).toHaveLength(entries.length);

    const sortedTopics = [...entries].map((e) => e.topic).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    const renderedTopics = [...items].map((li) => li.textContent?.split(" → ")[0]);
    expect(renderedTopics[0]).toBe(sortedTopics[0]);
    expect(renderedTopics.at(-1)).toBe(sortedTopics.at(-1));
  });

  it("links a resolved unit target to its unit anchor", () => {
    render(<CrossViewTopicIndex />);
    const link = screen.getByRole("link", { name: "Instruments 1" });
    expect(link).toHaveAttribute("href", "#instruments-1");
  });

  it("renders an unresolved target (e.g. the bare doc_no half of Agent Tokens) as plain text, not a link", () => {
    render(<CrossViewTopicIndex />);
    expect(screen.queryByRole("link", { name: "A.4.5" })).not.toBeInTheDocument();
    expect(screen.getByText("A.4.5")).toBeInTheDocument();
  });
});
