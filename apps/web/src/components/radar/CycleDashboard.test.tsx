// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { FORUM_CYCLES } from "@/lib/forumKinds";

vi.mock("../AtlasLink", () => ({
  AtlasLink: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

const loadForumTopics = vi.fn();
vi.mock("../../lib/forumTopics", () => ({
  loadForumTopics: (...a: unknown[]) => loadForumTopics(...a),
}));

import { CycleDashboard } from "./CycleDashboard";

afterEach(() => {
  cleanup();
  loadForumTopics.mockReset();
});

const cycle = FORUM_CYCLES[0];

describe("CycleDashboard", () => {
  it("always links the Atlas definition and the live forum tag", async () => {
    loadForumTopics.mockResolvedValue({ topics: [], fetchedAt: null });
    render(<CycleDashboard cycle={cycle} />);
    const atlas = await screen.findByRole("link", { name: "Atlas definition" });
    expect(atlas).toHaveAttribute("href", expect.stringContaining(cycle.atlasDocId));
    const tag = screen.getByRole("link", { name: "Sky Forum tag" });
    expect(tag).toHaveAttribute("href", cycle.forumTagUrl);
    expect(tag).toHaveAttribute("target", "_blank");
  });

  it("lists indexed threads after the worker payload arrives", async () => {
    loadForumTopics.mockResolvedValue({
      fetchedAt: "2026-08-24T12:00:00.000Z",
      topics: [
        {
          topicId: 28151,
          kind: "msc",
          title: "MSC #11: May 2026",
          slug: "msc-11",
          url: "https://forum.skyeco.com/t/msc-11/28151",
          poster: "SoterLabs",
          postedAt: "2026-06-01T12:00:00.000Z",
          lastPostedAt: null,
          tags: ["monthly-settlement-cycle"],
          postsCount: 4,
        },
      ],
    });
    render(<CycleDashboard cycle={cycle} />);
    const thread = await screen.findByRole("link", { name: "MSC #11: May 2026" });
    expect(thread).toHaveAttribute("href", "https://forum.skyeco.com/t/msc-11/28151");
    expect(screen.getByText(/SoterLabs/)).toBeInTheDocument();
    expect(loadForumTopics).toHaveBeenCalledWith("msc");
  });

  it("falls back to the live tag when nothing is indexed yet", async () => {
    loadForumTopics.mockResolvedValue({ topics: [], fetchedAt: null });
    render(<CycleDashboard cycle={cycle} />);
    await waitFor(() => expect(screen.getByText(/No indexed threads yet/)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Open the forum tag" })).toHaveAttribute(
      "href",
      cycle.forumTagUrl,
    );
  });
});
