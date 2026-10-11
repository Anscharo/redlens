import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { config } from "../config.ts";
import { checkChatModelIds, isListed, knownChain, resetModelCatalog } from "./model-catalog.ts";
import { resolveTierModels } from "./model-router.ts";

const CATALOG = new Set(["m/default", "m/strong", "m/strong-fallback", "openai/gpt-5.6-luna"]);
const saved = {
  chatModel: config.chatModel,
  chatModelFast: config.chatModelFast,
  chatModelStrong: config.chatModelStrong,
  chatModelFallbacks: config.chatModelFallbacks,
  chatSummaryModel: config.chatSummaryModel,
};
let realError: typeof console.error;

beforeEach(() => {
  realError = console.error;
  console.error = () => {};
  Object.assign(config, {
    chatModel: "m/default", chatModelFast: [], chatModelFallbacks: [], chatSummaryModel: "m/strong",
    chatModelStrong: ["m/strong", "openai/gpt-5.6-luna."],
  });
});

afterEach(() => {
  console.error = realError;
  Object.assign(config, saved);
  resetModelCatalog();
});

describe("checkChatModelIds", () => {
  test("flags a mistyped ID and leaves it out of the tier chain", async () => {
    expect(resolveTierModels("strong")).toEqual(["m/strong", "openai/gpt-5.6-luna."]);
    expect(await checkChatModelIds(async () => CATALOG)).toEqual(["openai/gpt-5.6-luna."]);
    expect(resolveTierModels("strong")).toEqual(["m/strong"]);
  });

  test("a tier whose every ID is unknown falls back to the default chain", async () => {
    config.chatModelStrong = ["openai/gpt-5.6-luna."];
    await checkChatModelIds(async () => CATALOG);
    expect(resolveTierModels("strong")).toEqual(["m/default"]);
  });

  test("an unreadable or empty catalog flags nothing", async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(await checkChatModelIds(async () => { throw new Error("offline"); })).toEqual([]);
      expect(await checkChatModelIds(async () => new Set())).toEqual([]);
    } finally {
      console.warn = warn;
    }
    expect(knownChain(["openai/gpt-5.6-luna."])).toEqual(["openai/gpt-5.6-luna."]);
  });
});

describe("isListed", () => {
  test("variant suffixes resolve to their base, OpenRouter routers always pass", () => {
    expect(isListed("openai/gpt-5.6-luna:nitro", CATALOG)).toBe(true);
    expect(isListed("openrouter/auto", CATALOG)).toBe(true);
    expect(isListed("openai/gpt-5.6-luna.", CATALOG)).toBe(false);
  });
});
