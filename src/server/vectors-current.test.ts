import { describe, expect, it } from "bun:test";
import { createVectorsCurrent, RECHECK_MS, STALE_WARN_MS } from "./vectors-current.ts";

describe("vectorsCurrent", () => {
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it("answers false until a check finds nothing stale, then latches", async () => {
    let clock = 0;
    let stale = true;
    let calls = 0;
    const v = createVectorsCurrent(async () => (calls++, stale), () => clock);
    expect(v.current()).toBe(false);
    await settle();
    expect(calls).toBe(1);
    expect(v.current()).toBe(false);
    await settle();
    expect(calls).toBe(1); // no recheck inside the minute

    stale = false;
    clock += RECHECK_MS;
    v.current();
    await settle();
    expect(calls).toBe(2);
    expect(v.current()).toBe(true);

    stale = true;
    clock += RECHECK_MS * 10;
    expect(v.current()).toBe(true);
    await settle();
    expect(calls).toBe(2); // latched: nothing rechecks once current
  });

  it("runs one check at a time", async () => {
    let calls = 0;
    let release!: (s: boolean) => void;
    const v = createVectorsCurrent(() => (calls++, new Promise<boolean>((r) => (release = r))), () => 0);
    const a = v.refresh();
    const b = v.refresh();
    expect(calls).toBe(1);
    release(false);
    await Promise.all([a, b]);
    expect(v.current()).toBe(true);
  });

  it("keeps the last answer when the check fails", async () => {
    const warn = console.warn;
    console.warn = () => {};
    try {
      const v = createVectorsCurrent(async () => {
        throw new Error("db down");
      }, () => 0);
      await v.refresh();
      expect(v.current()).toBe(false);
    } finally {
      console.warn = warn;
    }
  });

  it("warns when stale vectors outlast a re-embed, and not on every check", async () => {
    const warn = console.warn;
    const warned: string[] = [];
    console.warn = (m: string) => void warned.push(m);
    try {
      let clock = 0;
      const v = createVectorsCurrent(async () => true, () => clock);
      await v.refresh();
      clock = STALE_WARN_MS - 1;
      await v.refresh();
      expect(warned).toHaveLength(0); // a re-embed in progress is not a fault
      clock = STALE_WARN_MS;
      await v.refresh();
      expect(warned).toHaveLength(1);
      expect(warned[0]).toContain("EMBED_MODEL matches on the server and the atlas worker");
      clock += RECHECK_MS;
      await v.refresh();
      expect(warned).toHaveLength(1);
      clock += STALE_WARN_MS;
      await v.refresh();
      expect(warned).toHaveLength(2);
    } finally {
      console.warn = warn;
    }
  });

  it("counts empty tables as current", async () => {
    const v = createVectorsCurrent(async () => false, () => 0);
    await v.refresh();
    expect(v.current()).toBe(true);
  });
});
