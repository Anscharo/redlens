// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { loadSelection, saveSelection, STORAGE_KEY } from "./selectionStore";

beforeEach(() => {
  localStorage.clear();
});

describe("loadSelection", () => {
  it("returns [] when nothing is stored", () => {
    expect(loadSelection()).toEqual([]);
  });

  it("round-trips ids saved via saveSelection", () => {
    saveSelection(["a", "b", "c"]);
    expect(loadSelection()).toEqual(["a", "b", "c"]);
  });

  it("de-duplicates ids on load", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, ids: ["a", "a", "b"] }));
    expect(loadSelection()).toEqual(["a", "b"]);
  });

  it("returns [] for malformed JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    expect(loadSelection()).toEqual([]);
  });

  it("returns [] for a wrong schema version", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 2, ids: ["a"] }));
    expect(loadSelection()).toEqual([]);
  });

  it("returns [] when ids isn't an array", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, ids: "not-an-array" }));
    expect(loadSelection()).toEqual([]);
  });
});

describe("saveSelection", () => {
  it("persists the ids under STORAGE_KEY with schema version 1", () => {
    saveSelection(["x", "y"]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ v: 1, ids: ["x", "y"] });
  });

  it("overwrites a previously saved selection", () => {
    saveSelection(["a"]);
    saveSelection(["b", "c"]);
    expect(loadSelection()).toEqual(["b", "c"]);
  });
});
