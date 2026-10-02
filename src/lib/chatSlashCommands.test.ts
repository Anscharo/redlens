import { describe, it, expect } from "vitest";
import { CHAT_SLASH_COMMANDS, acceptSlashCompletion, completeSlashCommand } from "./chatSlashCommands";
import { parseTeachCommand } from "../server/chat/teach/parse.ts";

describe("completeSlashCommand", () => {
  it("offers the remainder of a command the draft is a prefix of", () => {
    const c = completeSlashCommand("/t");
    expect(c).toMatchObject({ lead: "", typed: "/t", rest: "each" });
    expect(c?.command.cmd).toBe("/teach");
  });

  it("matches case-insensitively but keeps the user's casing in `typed`", () => {
    const c = completeSlashCommand("/TE");
    expect(c).toMatchObject({ typed: "/TE", rest: "ach" });
  });

  it("returns null once the command is fully spelled", () => {
    expect(completeSlashCommand("/teach")).toBeNull();
    expect(completeSlashCommand("/TEACH")).toBeNull();
  });

  it("returns null once the token is followed by anything", () => {
    expect(completeSlashCommand("/t ")).toBeNull();
    expect(completeSlashCommand("/teach note")).toBeNull();
    expect(completeSlashCommand("/t\n")).toBeNull();
  });

  it("returns null for a slash that is not the first token", () => {
    expect(completeSlashCommand("what does /t")).toBeNull();
    expect(completeSlashCommand("")).toBeNull();
    expect(completeSlashCommand("teach")).toBeNull();
  });

  it("returns null when no command starts with the token", () => {
    expect(completeSlashCommand("/x")).toBeNull();
    expect(completeSlashCommand("/teachx")).toBeNull();
  });

  it("picks the first registered command on a bare slash", () => {
    const cmds = [
      { cmd: "/alpha", description: "" },
      { cmd: "/beta", description: "" },
    ];
    expect(completeSlashCommand("/", cmds)?.command.cmd).toBe("/alpha");
    expect(completeSlashCommand("/b", cmds)?.rest).toBe("eta");
  });

  it("preserves leading whitespace so the accepted draft still starts with the command", () => {
    const c = completeSlashCommand("  /t");
    expect(c?.lead).toBe("  ");
    expect(acceptSlashCompletion(c!)).toBe("  /teach ");
  });

  it("accepts into the canonical spelling plus a trailing space", () => {
    expect(acceptSlashCompletion(completeSlashCommand("/T")!)).toBe("/teach ");
  });
});

// Every command the composer advertises must be one the server recognises —
// otherwise a future registry entry would autocomplete into an ordinary
// question. Extend this when a second server-side command parser lands.
describe("CHAT_SLASH_COMMANDS", () => {
  it("only lists commands the server parses", () => {
    for (const { cmd } of CHAT_SLASH_COMMANDS) {
      const accepted = acceptSlashCompletion(completeSlashCommand(cmd.slice(0, 2))!);
      expect(accepted).toBe(`${cmd} `);
      expect(parseTeachCommand(accepted), `${cmd} is not parsed by the server`).not.toBeNull();
    }
  });
});
