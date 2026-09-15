// @vitest-environment jsdom

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ActorContact } from "./ActorContact";
import type { ActorContact as ActorContactData } from "../../lib/actorIndex";

afterEach(cleanup);

describe("ActorContact", () => {
  it("renders nothing when channels and emergency are both empty", () => {
    const { container } = render(
      <ActorContact contact={{ channels: [], emergency: [] }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the Contact heading and a forum channel with its category", () => {
    const contact: ActorContactData = {
      channels: [{ platform: "forum", category: "Governance", docId: "doc-1" }],
      emergency: [],
    };
    render(<ActorContact contact={contact} />);
    expect(screen.getByText("Contact")).toBeInTheDocument();
    expect(screen.getByText("Sky Forum")).toBeInTheDocument();
    expect(screen.getByText(/Governance/)).toBeInTheDocument();
  });

  it("renders a discord channel with url as a link showing the bare url", () => {
    const contact: ActorContactData = {
      channels: [{ platform: "discord", url: "https://discord.gg/abc123", docId: "doc-2" }],
      emergency: [],
    };
    render(<ActorContact contact={contact} />);
    const link = screen.getByRole("link", { name: "discord.gg/abc123" });
    expect(link).toHaveAttribute("href", "https://discord.gg/abc123");
  });

  it("renders a discord channel without url as an AtlasLink labeled Discord", () => {
    const contact: ActorContactData = {
      channels: [{ platform: "discord", docId: "doc-3" }],
      emergency: [],
    };
    render(<ActorContact contact={contact} />);
    expect(screen.getByRole("link", { name: "Discord" })).toBeInTheDocument();
  });

  it("hides placeholder emergencies — those belong on Omni only when specified", () => {
    const { container } = render(
      <ActorContact
        contact={{
          channels: [],
          emergency: [{ scope: "ecosystem", status: "placeholder", docId: "doc-4" }],
        }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("does not list a specified emergency under Contact", () => {
    render(
      <ActorContact
        contact={{
          channels: [{ platform: "forum", category: "Spark Prime", docId: "doc-1" }],
          emergency: [{ scope: "agent_specific", status: "specified", docId: "doc-5" }],
        }}
      />,
    );
    expect(screen.queryByText("Response protocol")).not.toBeInTheDocument();
    expect(screen.queryByText(/Emergency/)).not.toBeInTheDocument();
    expect(screen.getByText("Sky Forum")).toBeInTheDocument();
  });
});
