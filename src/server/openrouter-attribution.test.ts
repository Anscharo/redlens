import { afterEach, expect, test } from "bun:test";
import { openrouterAppTitle, openrouterAttributionHeaders, openrouterEnvironment } from "./openrouter-attribution.ts";

const KEYS = ["RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT", "OPENROUTER_APP_KIND"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const argv1 = process.argv[1];

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  process.argv[1] = argv1;
});

function clear() {
  for (const k of KEYS) delete process.env[k];
  process.argv[1] = "/app/src/server/index.ts";
}

test("Local when no Railway env is present", () => {
  clear();
  expect(openrouterAppTitle()).toBe("Sky Atlas Redline (Local)");
});

test("uses the Railway environment name", () => {
  clear();
  process.env.RAILWAY_ENVIRONMENT_NAME = "production";
  expect(openrouterAppTitle()).toBe("Sky Atlas Redline (production)");
  process.env.RAILWAY_ENVIRONMENT_NAME = "pr-211";
  expect(openrouterAppTitle()).toBe("Sky Atlas Redline (pr-211)");
});

test("evals win over environment", () => {
  clear();
  process.env.RAILWAY_ENVIRONMENT_NAME = "production";
  process.argv[1] = "/repo/scripts/eval/eval-golden.ts";
  expect(openrouterAppTitle()).toBe("Sky Atlas Redline Evals");
  process.argv[1] = "/repo/scripts/aux/x.ts";
  process.env.OPENROUTER_APP_KIND = "eval";
  expect(openrouterAppTitle()).toBe("Sky Atlas Redline Evals");
});

test("falls back to RAILWAY_ENVIRONMENT, and past empty/blank values to Local", () => {
  clear();
  process.env.RAILWAY_ENVIRONMENT = "staging";
  expect(openrouterAppTitle()).toBe("Sky Atlas Redline (staging)");
  process.env.RAILWAY_ENVIRONMENT_NAME = "";
  expect(openrouterAppTitle()).toBe("Sky Atlas Redline (staging)");
  process.env.RAILWAY_ENVIRONMENT_NAME = "  ";
  process.env.RAILWAY_ENVIRONMENT = "  ";
  expect(openrouterAppTitle()).toBe("Sky Atlas Redline (Local)");
});

test("detects eval scripts on Windows-style paths", () => {
  clear();
  process.argv[1] = "C:\\repo\\scripts\\eval\\eval-golden.ts";
  expect(openrouterAppTitle()).toBe("Sky Atlas Redline Evals");
});

test("headers carry the title as X-Title", () => {
  clear();
  expect(openrouterAttributionHeaders()).toEqual({ "X-Title": "Sky Atlas Redline (Local)" });
});

test("PostHog environment label: local, Railway name, eval", () => {
  clear();
  expect(openrouterEnvironment()).toBe("local");
  process.env.RAILWAY_ENVIRONMENT_NAME = "production";
  expect(openrouterEnvironment()).toBe("production");
  process.env.OPENROUTER_APP_KIND = "eval";
  expect(openrouterEnvironment()).toBe("eval");
});
