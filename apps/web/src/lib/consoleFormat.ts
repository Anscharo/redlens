// Serialization layer for console capture (see consoleBuffer.ts). Turns a
// console call's arguments into plain strings at push time, so the ring
// buffer never retains live references — an Error closes over its whole
// scope, a DOM node over a detached subtree, and either one held past the
// moment of the log call is a memory leak.

export const MAX_ARGS = 6;
export const MAX_ENTRY_CHARS = 400;

export function truncate(s: string): string {
  return s.length > MAX_ENTRY_CHARS ? s.slice(0, MAX_ENTRY_CHARS - 1) + "…" : s;
}

function isErrorLike(v: object): v is Error {
  return "name" in v && "message" in v && "stack" in v;
}

function errorText(e: Error): string {
  const header = `${e.name}: ${e.message}`;
  const stackLines = String(e.stack ?? "").split("\n").slice(0, 6);
  return [header, ...stackLines].join("\n");
}

function nodeText(n: Node): string {
  const el = n as unknown as { tagName?: string; id?: string; className?: unknown };
  const tag = (el.tagName ?? n.nodeName).toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const cls =
    typeof el.className === "string" && el.className.trim()
      ? "." + el.className.trim().split(/\s+/).join(".")
      : "";
  return `<${tag}${id}${cls}>`;
}

// Depth-capped, array-capped, circular-safe recursive serializer feeding
// JSON.stringify. WeakSet marks objects currently on the path from the root;
// re-encountering one (true cycle, or just a shared reference) prints
// "[Circular]" rather than recursing forever or blowing up the payload.
function serialize(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  if (depth >= 3) return Array.isArray(value) ? "[Array]" : "[Object]";
  seen.add(value);
  if (Array.isArray(value)) {
    const items = value.slice(0, 20).map((it) => serialize(it, depth + 1, seen));
    if (value.length > 20) items.push(`…+${value.length - 20} more`);
    return items;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = serialize(v, depth + 1, seen);
  }
  return out;
}

// Formats a single console-call argument as a plain string. Wrapped entirely
// in try/catch: throwing getters, Proxies, and throwing toJSON must never
// escape this function — they fall back to Object.prototype.toString.
export function formatArg(v: unknown): string {
  try {
    if (typeof v === "string") return v;
    if (v === null || v === undefined) return String(v);
    if (typeof v === "function") return `[Function ${v.name || "anonymous"}]`;
    if (typeof v !== "object") return String(v);
    if (isErrorLike(v)) return errorText(v);
    if (typeof Node !== "undefined" && v instanceof Node) return nodeText(v);
    if (typeof Response !== "undefined" && v instanceof Response) return `[Response ${v.status} ${v.url}]`;
    if (typeof Request !== "undefined" && v instanceof Request) return `[Request ${v.method} ${v.url}]`;
    if (typeof Event !== "undefined" && v instanceof Event) return `[Event ${v.type}]`;
    return JSON.stringify(serialize(v, 0, new WeakSet()));
  } catch {
    return Object.prototype.toString.call(v);
  }
}

export function argsToText(args: unknown[]): string {
  return truncate(args.slice(0, MAX_ARGS).map(formatArg).join(" "));
}
