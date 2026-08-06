// Node-env tests for the PURE half only (buildFeedbackContext) — the hook
// wrapper (useFeedbackContext) is exercised indirectly via
// FeedbackModal.test.tsx (jsdom).
import { describe, it, expect } from "vitest";
import { buildFeedbackContext, type FeedbackContextInputs } from "./feedbackContext";
import { MAX_SNAPSHOT_CHARS, type LogEntry } from "./consoleBuffer";
import { liveAtlasSha } from "./atlasBase";

const LIVE_SHA = "a".repeat(40);
const PREVIEW_SHA = "b".repeat(40);

function baseInputs(overrides: Partial<FeedbackContextInputs> = {}): FeedbackContextInputs {
  return {
    pathname: "/atlas",
    search: "?id=abc",
    hostname: "atlas.redline.support",
    nodeId: undefined,
    appCommit: "deadbeef",
    liveAtlasSha: LIVE_SHA,
    dataSource: { base: `/api/atlas/${LIVE_SHA}/`, preview: null },
    viewportWidth: 1280,
    viewportHeight: 800,
    dpr: 2,
    language: "en-US",
    referrer: "",
    theme: undefined,
    sessionId: null,
    consoleEntries: [],
    ...overrides,
  };
}

describe("buildFeedbackContext — atlasBase / atlasCommit / previewId", () => {
  it("uses the live base/sha when not in preview", () => {
    const ctx = buildFeedbackContext(baseInputs());
    expect(ctx.atlasBase).toBe(`/api/atlas/${LIVE_SHA}/`);
    expect(ctx.atlasCommit).toBe(LIVE_SHA);
    expect(ctx.previewId).toBeUndefined();
  });

  it("uses the preview base/sha/id when in preview mode — a preview bug is a different bug from a live one", () => {
    const ctx = buildFeedbackContext(
      baseInputs({
        dataSource: { base: "/api/preview/pr-9/", preview: { id: "pr-9", sha: PREVIEW_SHA } },
      }),
    );
    expect(ctx.atlasBase).toBe("/api/preview/pr-9/");
    expect(ctx.atlasCommit).toBe(PREVIEW_SHA);
    expect(ctx.previewId).toBe("pr-9");
  });

  it("never lets the unsubstituted {{ATLAS_SHA}} placeholder reach atlasCommit", () => {
    // Exercise the REAL guard in atlasBase.ts by stubbing window with the
    // literal placeholder value, exactly as a stale cached shell would.
    const original = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: { __ATLAS_SHA__?: string } }).window = { __ATLAS_SHA__: "{{ATLAS_SHA}}" };
    try {
      const guarded = liveAtlasSha();
      expect(guarded).toBeNull();
      const ctx = buildFeedbackContext(baseInputs({ liveAtlasSha: guarded, dataSource: { base: "/", preview: null } }));
      expect(ctx.atlasCommit).toBeUndefined();
    } finally {
      (globalThis as { window?: unknown }).window = original;
    }
  });
});

describe("buildFeedbackContext — console", () => {
  it("redacts secret-shaped console entry text", () => {
    const entries: LogEntry[] = [
      { seq: 1, t: 0, level: "error", text: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456" },
    ];
    const ctx = buildFeedbackContext(baseInputs({ consoleEntries: entries }));
    expect(ctx.console[0].text).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(ctx.console[0].text).toContain("Bearer [key]");
  });

  it("does not over-redact an on-chain address (the atlas's actual subject matter)", () => {
    const entries: LogEntry[] = [
      { seq: 1, t: 0, level: "log", text: "resolved 0x1234567890abcdef1234567890abcdef12345678" },
    ];
    const ctx = buildFeedbackContext(baseInputs({ consoleEntries: entries }));
    expect(ctx.console[0].text).toContain("0x1234567890abcdef1234567890abcdef12345678");
  });

  it("caps a maximal console buffer to the snapshot budget and keeps the whole payload well under 32KB", () => {
    const entries: LogEntry[] = Array.from({ length: 200 }, (_, i) => ({
      seq: i,
      t: i,
      level: (i % 5 === 0 ? "error" : "log") as LogEntry["level"],
      text: `line ${i} `.repeat(50), // ~600 chars each — far over budget in aggregate
    }));
    const ctx = buildFeedbackContext(
      baseInputs({
        consoleEntries: entries,
        referrer: "https://example.com/" + "x".repeat(200),
      }),
    );
    const totalConsoleChars = ctx.console.reduce((n, e) => n + e.text.length, 0);
    expect(totalConsoleChars).toBeLessThanOrEqual(MAX_SNAPSHOT_CHARS);
    // A maximal-shaped payload (message excluded — that's the caller's field,
    // capped separately at 2000 chars server-side) still fits comfortably
    // under the server's 32KB request-body cap.
    expect(JSON.stringify(ctx).length).toBeLessThan(32 * 1024);
  });
});

describe("buildFeedbackContext — url", () => {
  it("caps url (pathname + search) to 500 chars", () => {
    const ctx = buildFeedbackContext(baseInputs({ search: "?q=" + "x".repeat(1000) }));
    expect(ctx.url.length).toBeLessThanOrEqual(500);
    expect(ctx.url.startsWith("/atlas?q=")).toBe(true);
  });

  it("route mirrors the pathname (not the full url with query)", () => {
    const ctx = buildFeedbackContext(baseInputs({ pathname: "/radar/some-actor", search: "?tab=history" }));
    expect(ctx.context.route).toBe("/radar/some-actor");
  });
});

describe("buildFeedbackContext — context allowlist shape", () => {
  it("only emits the five allowlisted context keys, matching the server's CONTEXT_KEYS", () => {
    const ctx = buildFeedbackContext(baseInputs({ theme: "dark" }));
    expect(Object.keys(ctx.context).sort()).toEqual(["language", "referrer", "route", "theme", "viewport"]);
    expect(ctx.context.viewport).toBe("1280x800@2");
  });

  it("omits theme entirely when not supplied (no accidental 'undefined' string)", () => {
    const ctx = buildFeedbackContext(baseInputs({ theme: undefined }));
    expect(ctx.context.theme).toBeUndefined();
  });
});
