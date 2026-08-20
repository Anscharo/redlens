// @vitest-environment jsdom
// Smoke test: CrossViewConcepts/CrossViewAudit are thin wrappers over CrossViewMarkdown
// fed the build-time `?raw` imports of docs/crossview/*.md — CrossViewMarkdown's own
// rendering behavior is covered by CrossViewMarkdown.test.tsx, so this only checks
// each wrapper passes the right raw content through (and the `sticky` toggle).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const crossviewMarkdownMock = vi.fn();
vi.mock("./CrossViewMarkdown", () => ({
  CrossViewMarkdown: (props: { raw: string; sticky?: boolean }) => {
    crossviewMarkdownMock(props);
    return <div data-testid="crossview-markdown">{props.raw}</div>;
  },
}));

import { CrossViewConcepts, CrossViewAudit } from "./CrossViewConcepts";
import conceptsRaw from "../../../../../docs/crossview/concepts.md?raw";
import auditRaw from "../../../../../docs/crossview/concepts-audit.md?raw";

afterEach(cleanup);

describe("CrossViewConcepts", () => {
  it("renders the concepts doc through CrossViewMarkdown with sticky enabled", () => {
    render(<CrossViewConcepts />);
    expect(screen.getByTestId("crossview-markdown")).toHaveTextContent("# Atlas Concept Catalog");
    expect(crossviewMarkdownMock).toHaveBeenCalledWith(expect.objectContaining({ raw: conceptsRaw, sticky: true }));
  });
});

describe("CrossViewAudit", () => {
  it("renders the audit doc through CrossViewMarkdown without sticky", () => {
    render(<CrossViewAudit />);
    expect(screen.getByTestId("crossview-markdown")).toHaveTextContent(auditRaw.trim().slice(0, 15));
    const call = crossviewMarkdownMock.mock.calls.at(-1)?.[0];
    expect(call.raw).toBe(auditRaw);
    expect(call.sticky).toBeUndefined();
  });
});
