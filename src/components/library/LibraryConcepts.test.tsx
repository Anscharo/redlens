// @vitest-environment jsdom
// Smoke test: LibraryConcepts/LibraryAudit are thin wrappers over LibraryMarkdown
// fed the build-time `?raw` imports of docs/library/*.md — LibraryMarkdown's own
// rendering behavior is covered by LibraryMarkdown.test.tsx, so this only checks
// each wrapper passes the right raw content through (and the `sticky` toggle).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const libraryMarkdownMock = vi.fn();
vi.mock("./LibraryMarkdown", () => ({
  LibraryMarkdown: (props: { raw: string; sticky?: boolean }) => {
    libraryMarkdownMock(props);
    return <div data-testid="library-markdown">{props.raw}</div>;
  },
}));

import { LibraryConcepts, LibraryAudit } from "./LibraryConcepts";
import conceptsRaw from "../../../docs/library/concepts.md?raw";
import auditRaw from "../../../docs/library/concepts-audit.md?raw";

afterEach(cleanup);

describe("LibraryConcepts", () => {
  it("renders the concepts doc through LibraryMarkdown with sticky enabled", () => {
    render(<LibraryConcepts />);
    expect(screen.getByTestId("library-markdown")).toHaveTextContent("# Atlas Concept Catalog");
    expect(libraryMarkdownMock).toHaveBeenCalledWith(expect.objectContaining({ raw: conceptsRaw, sticky: true }));
  });
});

describe("LibraryAudit", () => {
  it("renders the audit doc through LibraryMarkdown without sticky", () => {
    render(<LibraryAudit />);
    expect(screen.getByTestId("library-markdown")).toHaveTextContent(auditRaw.trim().slice(0, 15));
    const call = libraryMarkdownMock.mock.calls.at(-1)?.[0];
    expect(call.raw).toBe(auditRaw);
    expect(call.sticky).toBeUndefined();
  });
});
