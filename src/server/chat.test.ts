// Pure message-size-cap tests. handleChat itself needs a session/DB fixture
// (integration-only); the byte-cap check is pure, so it's tested directly —
// same pattern as rate-limit.test.ts's bucketBounds.
import { test, expect } from "bun:test";
import { messageExceedsLimit, MAX_MESSAGE_BYTES } from "./chat.ts";

test("a normal-sized message is not rejected", () => {
  expect(messageExceedsLimit("What does the atlas say about facilitators?")).toBe(false);
});

test("a message exactly at the limit is not rejected", () => {
  expect(messageExceedsLimit("a".repeat(MAX_MESSAGE_BYTES))).toBe(false);
});

test("a message one byte over the limit is rejected", () => {
  expect(messageExceedsLimit("a".repeat(MAX_MESSAGE_BYTES + 1))).toBe(true);
});

test("a multi-MB message is rejected (the bug: first oversized request always landed)", () => {
  expect(messageExceedsLimit("x".repeat(5_000_000))).toBe(true);
});

test("byte length, not char length, is what's capped (multi-byte UTF-8 counts more)", () => {
  // Each "😀" is 4 UTF-8 bytes but 2 UTF-16 code units — a naive .length check
  // would undercount by ~2x for emoji-heavy input.
  const emoji = "😀".repeat(Math.ceil(MAX_MESSAGE_BYTES / 4) + 10);
  expect(emoji.length * 1).toBeLessThan(Buffer.byteLength(emoji, "utf8"));
  expect(messageExceedsLimit(emoji)).toBe(true);
});
