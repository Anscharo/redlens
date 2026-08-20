// Test doubles for the browser primitives the reader leans on that jsdom does
// not implement: Web Workers (search/atlas/graph) and EventSource (preview SSE).
// Each mock records what was posted/opened and lets a test drive inbound
// messages, so component/hook tests can exercise the real message-handling code
// without a live worker or server. Install with the helpers at the bottom and
// restore in afterEach.

type Listener = (e: unknown) => void;

export class MockWorker {
  static instances: MockWorker[] = [];
  static reset() {
    MockWorker.instances = [];
  }
  static last(): MockWorker {
    const w = MockWorker.instances.at(-1);
    if (!w) throw new Error("MockWorker: no instance constructed yet");
    return w;
  }

  url: string | URL;
  options?: WorkerOptions;
  posted: unknown[] = [];
  terminated = false;
  onmessage: Listener | null = null;
  onerror: Listener | null = null;
  private listeners: Record<string, Listener[]> = {};

  constructor(url: string | URL, options?: WorkerOptions) {
    this.url = url;
    this.options = options;
    MockWorker.instances.push(this);
  }

  addEventListener(type: string, cb: Listener) {
    (this.listeners[type] ??= []).push(cb);
  }
  removeEventListener(type: string, cb: Listener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== cb);
  }
  postMessage(msg: unknown) {
    this.posted.push(msg);
  }
  terminate() {
    this.terminated = true;
  }

  /** Deliver a message from the "worker" to the main thread. */
  emit(data: unknown) {
    const e = { data };
    this.onmessage?.(e);
    (this.listeners.message ?? []).forEach((f) => f(e));
  }
  /** Fire the worker's error event. */
  emitError(message = "worker failed") {
    const e = { message };
    this.onerror?.(e);
    (this.listeners.error ?? []).forEach((f) => f(e));
  }
}

export class MockEventSource {
  static instances: MockEventSource[] = [];
  static reset() {
    MockEventSource.instances = [];
  }
  static last(): MockEventSource {
    const es = MockEventSource.instances.at(-1);
    if (!es) throw new Error("MockEventSource: no instance constructed yet");
    return es;
  }

  url: string;
  closed = false;
  onerror: Listener | null = null;
  private listeners: Record<string, Listener[]> = {};

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: Listener) {
    (this.listeners[type] ??= []).push(cb);
  }
  removeEventListener(type: string, cb: Listener) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== cb);
  }
  close() {
    this.closed = true;
  }

  /** Deliver a named SSE event whose `data` is the JSON-encoded payload. */
  emit(type: string, payload: unknown) {
    const e = { data: JSON.stringify(payload) };
    (this.listeners[type] ?? []).forEach((f) => f(e));
  }
  emitError() {
    this.onerror?.(new Event("error"));
  }
}

export function installMockWorker(): () => void {
  const prev = (globalThis as { Worker?: unknown }).Worker;
  MockWorker.reset();
  (globalThis as { Worker?: unknown }).Worker = MockWorker as unknown;
  return () => {
    (globalThis as { Worker?: unknown }).Worker = prev;
  };
}

export function installMockEventSource(): () => void {
  const prev = (globalThis as { EventSource?: unknown }).EventSource;
  MockEventSource.reset();
  (globalThis as { EventSource?: unknown }).EventSource = MockEventSource as unknown;
  return () => {
    (globalThis as { EventSource?: unknown }).EventSource = prev;
  };
}
