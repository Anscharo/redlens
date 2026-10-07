import { expect, test } from "bun:test";
import { sleep, withTimeout } from "./retry.ts";

test("sleep resolves after the delay", async () => {
  const t0 = Date.now();
  await sleep(30);
  expect(Date.now() - t0).toBeGreaterThanOrEqual(25);
});

test("sleep resolves immediately for an already-aborted signal", async () => {
  const t0 = Date.now();
  await sleep(5_000, AbortSignal.abort());
  expect(Date.now() - t0).toBeLessThan(1_000);
});

test("sleep resolves as soon as the signal aborts mid-wait", async () => {
  const ctl = new AbortController();
  const t0 = Date.now();
  setTimeout(() => ctl.abort(), 20);
  await sleep(5_000, ctl.signal);
  expect(Date.now() - t0).toBeLessThan(1_000);
});

test("sleep leaves an AbortSignal.timeout signal armed after the timer wins", async () => {
  const signal = AbortSignal.timeout(60);
  await sleep(5, signal);
  await Bun.sleep(100);
  expect(signal.aborted).toBe(true);
});

test("withTimeout passes the value through and rejects with the label on timeout", async () => {
  expect(await withTimeout(Promise.resolve(7), 1000, "x")).toBe(7);
  await expect(withTimeout(new Promise<never>(() => {}), 20, "embed")).rejects.toThrow(/embed timed out after 20ms/);
});
