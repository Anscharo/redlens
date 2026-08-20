import { describe, it, expect, vi } from "vitest";
import { createConsoleBuffer, fitConsole, type LogEntry, type LogLevel } from "./consoleBuffer";
import { installConsoleCapture } from "./consoleCapture";
import { formatArg } from "./consoleFormat";

function fakeConsole() {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    log: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  } as unknown as Console;
}

describe("createConsoleBuffer / Ring", () => {
  it("wraps at capacity: pushing 40 severe entries keeps only the newest 30", () => {
    const buf = createConsoleBuffer({ severe: 30, chatter: 20 });
    for (let i = 0; i < 40; i++) buf.push("error", `e${i}`);
    const snap = buf.snapshot();
    expect(snap).toHaveLength(30);
    // oldest 10 (e0..e9) were dropped; the surviving window is e10..e39.
    expect(snap.map((e) => e.text)).toEqual(Array.from({ length: 30 }, (_, i) => `e${i + 10}`));
  });

  it("two-ring property: 100 log entries do not evict a previously pushed error", () => {
    const buf = createConsoleBuffer({ severe: 30, chatter: 20 });
    buf.push("error", "the important error");
    for (let i = 0; i < 100; i++) buf.push("log", `chatter ${i}`);
    const snap = buf.snapshot();
    expect(snap.some((e) => e.level === "error" && e.text === "the important error")).toBe(true);
  });

  it("truncates an entry at 400 chars with a marker", () => {
    const buf = createConsoleBuffer();
    buf.push("log", "x".repeat(1000));
    const [entry] = buf.snapshot();
    expect(entry.text).toHaveLength(400);
    expect(entry.text.endsWith("…")).toBe(true);
  });

  it("snapshot orders ascending by seq across both rings", () => {
    const buf = createConsoleBuffer();
    buf.push("error", "a");
    buf.push("log", "b");
    buf.push("error", "c");
    buf.push("log", "d");
    const snap = buf.snapshot();
    for (let i = 1; i < snap.length; i++) {
      expect(snap[i].seq).toBeGreaterThan(snap[i - 1].seq);
    }
  });

  it("every snapshot entry's text is a string (no live references retained)", () => {
    const buf = createConsoleBuffer();
    const err = new Error("boom");
    const circ: Record<string, unknown> = {};
    circ.self = circ;
    buf.push("error", formatArg(err));
    buf.push("log", formatArg(circ));
    buf.push("log", formatArg({ a: 1, b: [1, 2, 3] }));
    for (const e of buf.snapshot()) {
      expect(typeof e.text).toBe("string");
    }
  });
});

describe("formatArg", () => {
  it("formats an Error with name, message, and at most 6 stack lines", () => {
    const e = new Error("boom");
    e.stack = "Error: boom\nat a\nat b\nat c\nat d\nat e\nat f\nat g\nat h";
    const text = formatArg(e);
    expect(text).toContain("Error");
    expect(text).toContain("boom");
    const stackLinesInOutput = text.split("\n").length - 1; // minus the header line
    expect(stackLinesInOutput).toBeLessThanOrEqual(6);
  });

  it("a circular object formats with [Circular]", () => {
    const o: Record<string, unknown> = { name: "loop" };
    o.self = o;
    expect(formatArg(o)).toContain("[Circular]");
  });

  it("a throwing getter falls back instead of throwing", () => {
    const bad = {
      get oops(): string {
        throw new Error("nope");
      },
    };
    expect(() => formatArg(bad)).not.toThrow();
    expect(typeof formatArg(bad)).toBe("string");
  });

  it("formats a function", () => {
    function namedFn() {}
    expect(formatArg(namedFn)).toBe("[Function namedFn]");
  });

  it("formats primitives via String()", () => {
    expect(formatArg(42)).toBe("42");
    expect(formatArg(null)).toBe("null");
    expect(formatArg(undefined)).toBe("undefined");
    expect(formatArg(true)).toBe("true");
  });
});

describe("installConsoleCapture", () => {
  it("passes through to the original method with the exact same args", () => {
    const buf = createConsoleBuffer();
    const fake = fakeConsole();
    const originalErrorSpy = fake.error;
    const uninstall = installConsoleCapture(buf, fake);
    fake.error("boom", { a: 1 });
    expect(vi.mocked(originalErrorSpy).mock.calls[0]).toEqual(["boom", { a: 1 }]);
    uninstall();
  });

  it("captures error/warn/log/info into the buffer", () => {
    const buf = createConsoleBuffer();
    const fake = fakeConsole();
    const uninstall = installConsoleCapture(buf, fake);
    fake.error("e1");
    fake.warn("w1");
    fake.log("l1");
    fake.info("i1");
    const levels = buf.snapshot().map((x) => x.level);
    expect(levels).toEqual(expect.arrayContaining(["error", "warn", "log", "info"]));
    uninstall();
  });

  it("uninstall restores the original method by identity", () => {
    const buf = createConsoleBuffer();
    const fake = fakeConsole();
    const originalError = fake.error;
    const originalLog = fake.log;
    const uninstall = installConsoleCapture(buf, fake);
    expect(fake.error).not.toBe(originalError);
    uninstall();
    expect(fake.error).toBe(originalError);
    expect(fake.log).toBe(originalLog);
  });

  it("a serializer that throws does not throw out of console.error", () => {
    const buf = createConsoleBuffer();
    const fake = fakeConsole();
    const originalErrorSpy = fake.error;
    const uninstall = installConsoleCapture(buf, fake);
    const bad = {
      get oops(): string {
        throw new Error("nope");
      },
    };
    expect(() => fake.error("context", bad)).not.toThrow();
    // toHaveBeenCalledWith would deep-compare `bad`, triggering the throwing
    // getter itself — check identity instead, which the pass-through promises.
    const call = vi.mocked(originalErrorSpy).mock.calls[0];
    expect(call[0]).toBe("context");
    expect(call[1]).toBe(bad);
    uninstall();
  });

  it("does not patch debug/trace/table/group", () => {
    const buf = createConsoleBuffer();
    const fake = fakeConsole();
    const originalDebug = fake.debug;
    const uninstall = installConsoleCapture(buf, fake);
    expect(fake.debug).toBe(originalDebug);
    uninstall();
  });
});

describe("fitConsole", () => {
  function entry(seq: number, level: LogLevel, text: string): LogEntry {
    return { seq, t: seq, level, text };
  }

  it("trims to budget, dropping oldest chatter first while keeping severe", () => {
    const entries: LogEntry[] = [
      entry(1, "error", "critical failure info"), // severe, oldest
      entry(2, "log", "chatter one"),
      entry(3, "log", "chatter two"),
      entry(4, "error", "second error"),
    ];
    const totalLen = entries.reduce((s, e) => s + e.text.length, 0);
    const budget = totalLen - entries[1].text.length; // room to drop exactly one entry
    const fitted = fitConsole(entries, budget);

    // the oldest chatter entry (seq 2) is gone; both errors survive.
    expect(fitted.find((e) => e.seq === 2)).toBeUndefined();
    expect(fitted.some((e) => e.seq === 1)).toBe(true);
    expect(fitted.some((e) => e.seq === 4)).toBe(true);
  });

  it("falls back to dropping oldest severe once chatter is exhausted", () => {
    const entries: LogEntry[] = [
      entry(1, "error", "aaaaaaaaaa"),
      entry(2, "error", "bbbbbbbbbb"),
      entry(3, "log", "c"),
    ];
    const fitted = fitConsole(entries, 11); // must drop the small chatter entry, still over budget
    expect(fitted.find((e) => e.level === "log")).toBeUndefined();
    expect(fitted.find((e) => e.seq === 1)).toBeUndefined(); // oldest severe dropped next
    expect(fitted.find((e) => e.seq === 2)).toBeDefined();
  });

  it("returns everything unchanged when already within budget", () => {
    const entries: LogEntry[] = [entry(1, "log", "a"), entry(2, "error", "b")];
    expect(fitConsole(entries, 1000)).toEqual(entries);
  });
});
