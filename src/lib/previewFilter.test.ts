// @vitest-environment jsdom
// previewFilter derives two preview signals from data-source + diff + view state:
// the "changed only" id set, and per-node dimming of untouched docs. The three
// source hooks are mocked so we test the combination logic in isolation.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("./dataSource", () => ({ useDataSource: vi.fn() }));
vi.mock("./previewDiff", () => ({ usePreviewDiff: vi.fn() }));
vi.mock("./previewView", () => ({ usePreviewView: vi.fn() }));

import { usePreviewChangedSet, usePreviewDim } from "./previewFilter";
import { useDataSource } from "./dataSource";
import { usePreviewDiff } from "./previewDiff";
import { usePreviewView } from "./previewView";

const mockSource = vi.mocked(useDataSource);
const mockDiff = vi.mocked(usePreviewDiff);
const mockView = vi.mocked(usePreviewView);

function configure({
  preview = false,
  onlyChanged = false,
  added = [] as string[],
  changed = [] as string[],
}) {
  mockSource.mockReturnValue({ base: "/b/", preview: preview ? { id: "p", sha: "s" } : null });
  mockView.mockReturnValue({ onlyChanged } as ReturnType<typeof usePreviewView>);
  mockDiff.mockReturnValue({
    added: new Set(added),
    changed: new Set(changed),
    renumbered: {},
    reusedSlot: {},
    identitySwap: {},
    formerUuid: {},
  });
}

beforeEach(() => {
  mockSource.mockReset();
  mockDiff.mockReset();
  mockView.mockReset();
});

describe("usePreviewChangedSet", () => {
  it("is null outside preview mode", () => {
    configure({ preview: false, onlyChanged: true, added: ["a"] });
    expect(renderHook(() => usePreviewChangedSet()).result.current).toBeNull();
  });

  it("is null when the 'only changed' toggle is off", () => {
    configure({ preview: true, onlyChanged: false, added: ["a"], changed: ["b"] });
    expect(renderHook(() => usePreviewChangedSet()).result.current).toBeNull();
  });

  it("is the union of added and changed when preview + toggle are on", () => {
    configure({ preview: true, onlyChanged: true, added: ["a"], changed: ["b", "c"] });
    const set = renderHook(() => usePreviewChangedSet()).result.current;
    expect(set).not.toBeNull();
    expect([...set!].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("usePreviewDim", () => {
  it("never dims outside preview mode", () => {
    configure({ preview: false, added: ["a"] });
    expect(renderHook(() => usePreviewDim("z")).result.current).toBe(false);
  });

  it("does not dim added or changed docs", () => {
    configure({ preview: true, added: ["a"], changed: ["b"] });
    expect(renderHook(() => usePreviewDim("a")).result.current).toBe(false);
    expect(renderHook(() => usePreviewDim("b")).result.current).toBe(false);
  });

  it("dims an untouched doc in preview mode", () => {
    configure({ preview: true, added: ["a"], changed: ["b"] });
    expect(renderHook(() => usePreviewDim("untouched")).result.current).toBe(true);
  });
});
