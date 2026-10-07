// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Router } from "wouter";
import { ConversationsLink } from "./ConversationsLink";
import { DataSourceContext } from "../../lib/dataSource";

afterEach(cleanup);

describe("ConversationsLink", () => {
  it("is an in-app link on the live site", () => {
    render(<ConversationsLink>All</ConversationsLink>);
    expect(screen.getByText("All").getAttribute("href")).toBe("/conversations");
  });

  it("leaves the preview for the live conversations page instead of staying under its router base", () => {
    render(
      <DataSourceContext.Provider value={{ base: "/api/preview/x/", preview: { id: "pull-1", sha: "c".repeat(40) } }}>
        <Router base="/preview/pull-1">
          <ConversationsLink>All</ConversationsLink>
        </Router>
      </DataSourceContext.Provider>,
    );
    expect(screen.getByText("All").getAttribute("href")).toBe("/conversations");
  });
});
