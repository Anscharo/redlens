// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { writeResume, clearResume, readFreshResume, RESUME_WINDOW_MS } from "./resume";

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe("readFreshResume", () => {
  it("returns a snapshot younger than the window", () => {
    writeResume({ at: 1_000, conversationId: "c1", title: "T" });
    expect(readFreshResume(1_000 + RESUME_WINDOW_MS - 1)).toEqual({ at: 1_000, conversationId: "c1", title: "T" });
  });

  it("returns null (and clears) at exactly the window boundary and beyond", () => {
    writeResume({ at: 1_000, conversationId: "c1", title: "T" });
    expect(readFreshResume(1_000 + RESUME_WINDOW_MS)).toBeNull();
    expect(sessionStorage.getItem("rlc-resume")).toBeNull();
  });

  it("returns null when nothing is stored", () => {
    expect(readFreshResume()).toBeNull();
  });

  it("returns null (and clears) on malformed JSON", () => {
    sessionStorage.setItem("rlc-resume", "{not json");
    expect(readFreshResume()).toBeNull();
    expect(sessionStorage.getItem("rlc-resume")).toBeNull();
  });

  it("normalizes missing conversationId/title to null", () => {
    sessionStorage.setItem("rlc-resume", JSON.stringify({ at: 5_000 }));
    expect(readFreshResume(5_100)).toEqual({ at: 5_000, conversationId: null, title: null });
  });

  it("ignores a leftover localStorage snapshot (this key used to live there)", () => {
    localStorage.setItem("rlc-resume", JSON.stringify({ at: 1_000, conversationId: "other-tab", title: "Nope" }));
    expect(readFreshResume(1_100)).toBeNull();
  });
});

describe("clearResume", () => {
  it("removes the snapshot", () => {
    writeResume({ at: Date.now(), conversationId: null, title: null });
    clearResume();
    expect(readFreshResume()).toBeNull();
  });
});
