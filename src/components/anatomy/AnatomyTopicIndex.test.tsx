// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AnatomyTopicIndex } from "./AnatomyTopicIndex";
import { parseAnatomyIndex } from "../../lib/anatomyIndex";
import { extractHeadings } from "../../lib/anatomyHeadings";
import conceptsRaw from "../../../docs/anatomy/concepts.md?raw";

afterEach(cleanup);

describe("AnatomyTopicIndex", () => {
  it("renders a 'Topics' nav landmark with one row per parsed II.7 entry, alphabetically sorted", () => {
    render(<AnatomyTopicIndex />);
    const nav = screen.getByRole("navigation", { name: "Topics" });
    expect(nav).toHaveTextContent("Topics");

    const headings = extractHeadings(conceptsRaw);
    const entries = parseAnatomyIndex(conceptsRaw, headings);
    const items = nav.querySelectorAll("li");
    expect(items).toHaveLength(entries.length);

    const sortedTopics = [...entries].map((e) => e.topic).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    const renderedTopics = [...items].map((li) => li.textContent?.split(" → ")[0]);
    expect(renderedTopics[0]).toBe(sortedTopics[0]);
    expect(renderedTopics.at(-1)).toBe(sortedTopics.at(-1));
  });

  it("links a resolved unit target to its unit anchor", () => {
    render(<AnatomyTopicIndex />);
    const link = screen.getByRole("link", { name: "Instruments 1" });
    expect(link).toHaveAttribute("href", "#instruments-1");
  });

  it("renders an unresolved target (e.g. the bare doc_no half of Agent Tokens) as plain text, not a link", () => {
    render(<AnatomyTopicIndex />);
    expect(screen.queryByRole("link", { name: "A.4.5" })).not.toBeInTheDocument();
    expect(screen.getByText("A.4.5")).toBeInTheDocument();
  });
});
