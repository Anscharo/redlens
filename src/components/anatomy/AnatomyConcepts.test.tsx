// @vitest-environment jsdom
// Smoke test: AnatomyConcepts/AnatomyAudit are thin wrappers over AnatomyMarkdown
// fed the build-time `?raw` imports of docs/anatomy/*.md — AnatomyMarkdown's own
// rendering behavior is covered by AnatomyMarkdown.test.tsx, so this only checks
// each wrapper passes the right raw content through (and the `sticky` toggle).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const anatomyMarkdownMock = vi.fn();
vi.mock("./AnatomyMarkdown", () => ({
  AnatomyMarkdown: (props: { raw: string; sticky?: boolean }) => {
    anatomyMarkdownMock(props);
    return <div data-testid="anatomy-markdown">{props.raw}</div>;
  },
}));

import { AnatomyConcepts, AnatomyAudit } from "./AnatomyConcepts";
import conceptsRaw from "../../../docs/anatomy/concepts.md?raw";
import auditRaw from "../../../docs/anatomy/concepts-audit.md?raw";

afterEach(cleanup);

describe("AnatomyConcepts", () => {
  it("renders the concepts doc through AnatomyMarkdown with sticky enabled", () => {
    render(<AnatomyConcepts />);
    expect(screen.getByTestId("anatomy-markdown")).toHaveTextContent("# Atlas Concept Catalog");
    expect(anatomyMarkdownMock).toHaveBeenCalledWith(expect.objectContaining({ raw: conceptsRaw, sticky: true }));
  });
});

describe("AnatomyAudit", () => {
  it("renders the audit doc through AnatomyMarkdown without sticky", () => {
    render(<AnatomyAudit />);
    expect(screen.getByTestId("anatomy-markdown")).toHaveTextContent(auditRaw.trim().slice(0, 15));
    const call = anatomyMarkdownMock.mock.calls.at(-1)?.[0];
    expect(call.raw).toBe(auditRaw);
    expect(call.sticky).toBeUndefined();
  });
});
