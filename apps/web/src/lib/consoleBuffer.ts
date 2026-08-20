// Console capture for the RedLens feedback tool: a fixed-memory ring buffer
// over recent console activity, so a bug report can attach "what the console
// said". Nothing but strings are ever stored — see consoleFormat.ts for why
// retaining the original values would leak.
//
// This module is pure data: it patches nothing. Installation over the real
// console lives in consoleCapture.ts.
//
// It also does NOT call redact() — that's a separate concern
// (src/lib/redact.ts) applied by whatever assembles the final feedback
// payload from consoleSnapshot(), keeping this a pure capture layer.

import { truncate } from "./consoleFormat";

export type LogLevel = "error" | "warn" | "log" | "info" | "uncaught" | "rejection" | "resource";
export interface LogEntry {
  seq: number;
  t: number;
  level: LogLevel;
  text: string;
}

export interface ConsoleBuffer {
  push(level: LogLevel, text: string): void;
  snapshot(): LogEntry[];
}

const SEVERE_LEVELS = new Set<LogLevel>(["error", "warn", "uncaught", "rejection", "resource"]);
const CHATTER_LEVELS = new Set<LogLevel>(["log", "info"]);

export const MAX_SNAPSHOT_CHARS = 12_000;

let seqCounter = 0;

// Fixed-size ring buffer: preallocated array + write cursor. No arr.shift()
// (O(n) per push, and defeats the point of a fixed-capacity ring).
class Ring {
  private buf: (LogEntry | undefined)[];
  private capacity: number;
  private cursor = 0;
  private count = 0;
  constructor(capacity: number) {
    this.capacity = capacity;
    this.buf = new Array(capacity);
  }
  push(entry: LogEntry): void {
    this.buf[this.cursor] = entry;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }
  entries(): LogEntry[] {
    const out: LogEntry[] = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (this.cursor - this.count + i + this.capacity) % this.capacity;
      const e = this.buf[idx];
      if (e) out.push(e);
    }
    return out;
  }
}

// A console.log burst must never evict the console.error that explains the
// bug, so severe (error/warn/uncaught/rejection/resource) and chatter
// (log/info) get independent rings.
export function createConsoleBuffer(opts?: { severe?: number; chatter?: number }): ConsoleBuffer {
  const severe = new Ring(opts?.severe ?? 30);
  const chatter = new Ring(opts?.chatter ?? 20);
  return {
    push(level, text) {
      const entry: LogEntry = { seq: seqCounter++, t: Date.now(), level, text: truncate(text) };
      (SEVERE_LEVELS.has(level) ? severe : chatter).push(entry);
    },
    snapshot() {
      return [...severe.entries(), ...chatter.entries()].sort((a, b) => a.seq - b.seq);
    },
  };
}

// Drops the oldest chatter entry (lowest seq among log/info) first; once none
// remain, drops the oldest entry overall (severe). Repeats until the summed
// text length fits the budget.
export function fitConsole(entries: LogEntry[], budget: number): LogEntry[] {
  let list = [...entries];
  const totalChars = () => list.reduce((sum, e) => sum + e.text.length, 0);
  while (totalChars() > budget && list.length > 0) {
    const chatter = list.filter((e) => CHATTER_LEVELS.has(e.level));
    const pool = chatter.length > 0 ? chatter : list;
    const oldest = pool.reduce((a, b) => (a.seq <= b.seq ? a : b));
    list = list.filter((e) => e !== oldest);
  }
  return list;
}

export const defaultBuffer = createConsoleBuffer();

export function consoleSnapshot(): LogEntry[] {
  return defaultBuffer.snapshot();
}
