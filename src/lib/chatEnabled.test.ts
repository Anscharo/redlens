// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { chatEnabled } from "./chatEnabled";

// __CHAT_ENABLED__ (the build-time Vite define) is hardcoded to `false` for
// the whole vitest run (vitest.config.ts). This file must NOT assign
// `window.__CHAT_ENABLED__` to probe the runtime-flag branch — verified
// empirically while writing this test: under Vitest's jsdom pool,
// `window === globalThis`, and Vitest resolves the bare `__CHAT_ENABLED__`
// identifier (the build-time guard) against that same global object rather
// than inlining it as an immutable literal the way a real `vite build`
// would. So `window.__CHAT_ENABLED__` and the bare `__CHAT_ENABLED__` define
// are, in this test environment only, THE SAME BINDING — setting one flips
// the other, making "build off / runtime on" impossible to construct here
// (confirmed: assigning `window.__CHAT_ENABLED__ = true` makes the build
// guard read true too, and `chatEnabled()` returns true — the opposite of
// production behavior). This is a pre-existing characteristic of this test
// environment, not specific to this file: the same probe against
// usersEnabled() reproduces it identically.
//
// The only assertion that's safe and meaningful here is the untouched
// default. The `window.__CHAT_ENABLED__ === true` branch — the one the
// widget mount and the ProfileButton menu item will actually gate on — has
// NO unit coverage in this repo; verify it manually (`pnpm dev` with
// CHAT_ENABLED=1 and a signed-in session).
describe("chatEnabled", () => {
  it("returns false by default (build define off, no runtime flag injected)", () => {
    expect(chatEnabled()).toBe(false);
  });
});
