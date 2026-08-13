// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { writeResume, clearResume, readFreshResume, RESUME_WINDOW_MS } from "./resume";

afterEach(() => localStorage.clear());

describe("readFreshResume", () => {
  it("returns a snapshot younger than the window", () => {
    writeResume({ at: 1_000, conversationId: "c1", title: "T" });
    expect(readFreshResume(1_000 + RESUME_WINDOW_MS - 1)).toEqual({ at: 1_000, conversationId: "c1", title: "T" });
  });

  it("returns null (and clears) at exactly the window boundary and beyond", () => {
    writeResume({ at: 1_000, conversationId: "c1", title: "T" });
    expect(readFreshResume(1_000 + RESUME_WINDOW_MS)).toBeNull();
    expect(localStorage.getItem("rlc-resume")).toBeNull();
  });

  it("returns null when nothing is stored", () => {
    expect(readFreshResume()).toBeNull();
  });

  it("returns null (and clears) on malformed JSON", () => {
    localStorage.setItem("rlc-resume", "{not json");
    expect(readFreshResume()).toBeNull();
    expect(localStorage.getItem("rlc-resume")).toBeNull();
  });

  it("normalizes missing conversationId/title to null", () => {
    localStorage.setItem("rlc-resume", JSON.stringify({ at: 5_000 }));
    expect(readFreshResume(5_100)).toEqual({ at: 5_000, conversationId: null, title: null });
  });
});

describe("clearResume", () => {
  it("removes the snapshot", () => {
    writeResume({ at: Date.now(), conversationId: null, title: null });
    clearResume();
    expect(readFreshResume()).toBeNull();
  });
});
