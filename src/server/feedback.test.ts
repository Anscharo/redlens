// feedback.ts unit tests. Mocks ./db.ts COMPLETELY (mirrors collections.test.ts's
// convention) with a tiny in-memory `feedback` row array. session.ts is NOT
// mocked — a real signed JWT drives the signed-in path, and a near-expiry one
// (mirrors conversations.test.ts's nearExpiryToken) exercises the sliding-
// window refresh branch.
import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { SignJWT } from "jose";

interface FeedbackRow {
  id: string;
  created_at: string;
  user_id: string | null;
  submitter_key: string | null;
  message: string;
  message_hash: string;
  context: unknown;
  console: unknown;
  ph_sent: boolean;
}

let rows: FeedbackRow[] = [];
let insertParams: unknown[][] = [];

function nowIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function rateKeyOf(r: FeedbackRow): string | null {
  return r.user_id ?? r.submitter_key;
}

function execTag(strings: TemplateStringsArray, ...values: unknown[]) {
  const text = strings.join("?").replace(/\s+/g, " ").trim();

  if (text.includes("count(*)::int AS n FROM feedback")) {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const n = rows.filter((r) => new Date(r.created_at).getTime() > dayAgo).length;
    return Promise.resolve([{ n }]);
  }

  if (text.includes("AS hourly") && text.includes("AS daily") && text.includes("AS dupe")) {
    const [hash, rateKey] = values as [string, string];
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const tenMinAgo = now - 10 * 60 * 1000;
    const mine = rows.filter((r) => rateKeyOf(r) === rateKey);
    const hourly = mine.filter((r) => new Date(r.created_at).getTime() > hourAgo).length;
    const daily = mine.filter((r) => new Date(r.created_at).getTime() > dayAgo).length;
    const dupe = mine.filter(
      (r) => r.message_hash === hash && new Date(r.created_at).getTime() > tenMinAgo,
    ).length;
    return Promise.resolve([{ hourly, daily, dupe }]);
  }

  if (text.includes("INSERT INTO feedback")) {
    insertParams.push(values);
    // Positional — matches feedback.ts's column list exactly:
    // user_id, submitter_key, message, message_hash, url, host, app_commit,
    // atlas_commit, atlas_base, preview_id, node_id, session_id, user_agent,
    // context, console.
    const row: FeedbackRow = {
      id: crypto.randomUUID(),
      created_at: nowIso(),
      user_id: values[0] as string | null,
      submitter_key: values[1] as string | null,
      message: values[2] as string,
      message_hash: values[3] as string,
      context: values[13],
      console: values[14],
      ph_sent: false,
    };
    rows.push(row);
    return Promise.resolve([{ id: row.id }]);
  }

  if (text.includes("UPDATE feedback SET ph_sent")) {
    const [id] = values as [string];
    const row = rows.find((r) => r.id === id);
    if (row) row.ph_sent = true;
    return Promise.resolve([]);
  }

  throw new Error(`feedback.test.ts: unmocked query: ${text}`);
}

mock.module("./db.ts", () => ({
  sql: execTag,
  dbTarget: () => "mock-db",
  waitForDb: () => Promise.resolve(),
  toVectorLiteral: (vec: number[]) => `[${vec.join(",")}]`,
}));

const { handleFeedback } = await import("./feedback.ts");
const { validateFeedback, messageHash, normalizeConsole } = await import("./feedback-validate.ts") as unknown as {
  validateFeedback: (body: { message?: unknown }) => { ok: boolean; error?: string; message?: string };
  messageHash: (s: string) => string;
  normalizeConsole: (entries: unknown) => { level: string; text: string }[];
};
const { config } = await import("./config.ts");
const { signSession, SESSION_COOKIE } = await import("./session.ts");

afterAll(() => {
  mock.restore();
});

const origSecret = config.jwtSecret;
beforeAll(() => {
  config.jwtSecret = "test-secret-0123456789abcdef0123456789abcdef";
});
afterAll(() => {
  config.jwtSecret = origSecret;
});

beforeEach(() => {
  rows = [];
  insertParams = [];
});

async function authed(userId = "user-1"): Promise<string> {
  return await signSession({ id: userId, provider: "github" });
}

// signSession always signs a full 7-day TTL, far outside session.ts's 24h
// refresh threshold — mint one close to expiry directly to exercise the
// sliding-window refresh branch (mirrors conversations.test.ts).
async function nearExpiryToken(userId = "user-1"): Promise<string> {
  return await new SignJWT({ provider: "github" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(config.jwtSecret));
}

function req(
  path: string,
  init: RequestInit & { sessionCookie?: string; fbCookie?: string } = {},
): Request {
  const { sessionCookie, fbCookie, headers, ...rest } = init;
  const h = new Headers(headers);
  const parts: string[] = [];
  if (sessionCookie) parts.push(`${SESSION_COOKIE}=${sessionCookie}`);
  if (fbCookie) parts.push(`rl_fb=${fbCookie}`);
  if (parts.length) h.set("cookie", parts.join("; "));
  if (!h.has("content-type") && rest.body !== undefined) h.set("content-type", "application/json");
  return new Request(`http://x${path}`, { ...rest, headers: h });
}

function body(obj: Record<string, unknown>): string {
  return JSON.stringify(obj);
}

describe("method gate", () => {
  it("405s a non-POST request", async () => {
    const res = await handleFeedback(req("/api/feedback", { method: "GET" }));
    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({ error: "method_not_allowed" });
  });
});

describe("body parsing", () => {
  it("400s invalid JSON", async () => {
    const res = await handleFeedback(req("/api/feedback", { method: "POST", body: "{not json" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_json" });
  });

  it("413s a genuinely oversized body, checked before JSON.parse", async () => {
    const huge = body({ message: "x".repeat(config.feedbackMaxBytes + 1000) });
    expect(Buffer.byteLength(huge)).toBeGreaterThan(config.feedbackMaxBytes);
    const res = await handleFeedback(req("/api/feedback", { method: "POST", body: huge }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "payload_too_large" });
  });

  it("400s an empty/whitespace message", async () => {
    const res = await handleFeedback(req("/api/feedback", { method: "POST", body: body({ message: "  " }) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "empty_message" });
  });

  it("400s a message over 2000 chars", async () => {
    const res = await handleFeedback(
      req("/api/feedback", { method: "POST", body: body({ message: "x".repeat(2001) }) }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "message_too_long" });
  });
});

describe("anonymous submission", () => {
  it("201s, sets rl_fb, and a second POST carrying that cookie does not mint a new one", async () => {
    const res1 = await handleFeedback(
      req("/api/feedback", { method: "POST", body: body({ message: "the sidebar is broken" }) }),
    );
    expect(res1.status).toBe(201);
    const setCookie1 = res1.headers.getSetCookie().find((c) => c.startsWith("rl_fb="));
    expect(setCookie1).toBeDefined();
    const value1 = setCookie1!.split(";")[0].split("=")[1];

    const res2 = await handleFeedback(
      req("/api/feedback", {
        method: "POST",
        fbCookie: value1,
        body: body({ message: "a second, different report" }),
      }),
    );
    expect(res2.status).toBe(201);
    const setCookie2 = res2.headers.getSetCookie().find((c) => c.startsWith("rl_fb="));
    const value2 = setCookie2!.split(";")[0].split("=")[1];
    expect(value2).toBe(value1);

    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.user_id === null)).toBe(true);
  });
});

describe("signed-in submission", () => {
  it("records user_id and reattaches session.refresh — both Set-Cookie headers present", async () => {
    const token = await nearExpiryToken();
    const res = await handleFeedback(
      req("/api/feedback", { method: "POST", sessionCookie: token, body: body({ message: "chart is off by one" }) }),
    );
    expect(res.status).toBe(201);
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(true);
    expect(cookies.some((c) => c.startsWith("rl_fb="))).toBe(true);
    expect(rows[0].user_id).toBe("user-1");
  });
});

describe("honeypot", () => {
  it("200s and inserts nothing when the honeypot field is filled", async () => {
    const res = await handleFeedback(
      req("/api/feedback", {
        method: "POST",
        body: body({ message: "totally real feedback", website: "http://spam.example" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(rows.length).toBe(0);
  });
});

describe("timing floor", () => {
  it("200s silently with no insert when elapsedMs is below the floor", async () => {
    const res = await handleFeedback(
      req("/api/feedback", { method: "POST", body: body({ message: "too fast to be human", elapsedMs: 200 }) }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(rows.length).toBe(0);
  });
});

describe("rate limiting", () => {
  it("429s with Retry-After once the anonymous hourly cap is hit", async () => {
    for (let i = 0; i < 3; i++) {
      rows.push({
        id: `seed-${i}`,
        created_at: nowIso(),
        user_id: null,
        submitter_key: "anon-key-1",
        message: `seed ${i}`,
        message_hash: messageHash(`seed ${i}`),
        context: {},
        console: [],
        ph_sent: false,
      });
    }
    const res = await handleFeedback(
      req("/api/feedback", {
        method: "POST",
        fbCookie: "anon-key-1",
        body: body({ message: "one too many" }),
      }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).not.toBeNull();
    const j = (await res.json()) as { error: string; retryAfterSeconds: number };
    expect(j.error).toBe("rate_limited");
    expect(typeof j.retryAfterSeconds).toBe("number");
    expect(rows.length).toBe(3); // no new row inserted
  });

  it("a signed-in user is still accepted at 3 in the same hour (tiered, not shared)", async () => {
    for (let i = 0; i < 3; i++) {
      rows.push({
        id: `seed-${i}`,
        created_at: nowIso(),
        user_id: null,
        submitter_key: "anon-key-2",
        message: `seed ${i}`,
        message_hash: messageHash(`seed ${i}`),
        context: {},
        console: [],
        ph_sent: false,
      });
    }
    const token = await authed("user-2");
    const res = await handleFeedback(
      req("/api/feedback", {
        method: "POST",
        sessionCookie: token,
        fbCookie: "anon-key-2", // same cookie the anon rows used — must not matter, user_id wins the key
        body: body({ message: "signed-in user, different limit" }),
      }),
    );
    expect(res.status).toBe(201);
  });
});

describe("dedupe", () => {
  it("the same message twice within 10 minutes yields exactly one row", async () => {
    const payload = body({ message: "duplicate double-click report" });
    const res1 = await handleFeedback(req("/api/feedback", { method: "POST", fbCookie: "dupe-key", body: payload }));
    expect(res1.status).toBe(201);
    const res2 = await handleFeedback(req("/api/feedback", { method: "POST", fbCookie: "dupe-key", body: payload }));
    expect(res2.status).toBe(200);
    expect(await res2.json()).toEqual({ ok: true });
    expect(rows.length).toBe(1);
  });
});

describe("server-side clamping", () => {
  // These payloads are intentionally larger than the real feedbackMaxBytes
  // cap (32KB) — they simulate a buggy/rogue client sending an oversized
  // console buffer or context blob, which the 413 check would otherwise
  // reject before the clamp logic ever runs. Raise the byte cap just for
  // this block so the re-clamp behavior itself gets exercised.
  const origMaxBytes = config.feedbackMaxBytes;
  beforeAll(() => {
    config.feedbackMaxBytes = 10_000_000;
  });
  afterAll(() => {
    config.feedbackMaxBytes = origMaxBytes;
  });

  it("clamps a 500-entry, 10KB-each console buffer to <= 50 entries of <= 400 chars", async () => {
    const bigConsole = Array.from({ length: 500 }, (_, i) => ({ level: "error", text: `line-${i}-`.repeat(2000) }));
    const res = await handleFeedback(
      req("/api/feedback", {
        method: "POST",
        body: body({ message: "console spam report", console: bigConsole }),
      }),
    );
    expect(res.status).toBe(201);
    const stored = rows[0].console as { level: string; text: string }[];
    expect(stored.length).toBeLessThanOrEqual(50);
    for (const entry of stored) expect(entry.text.length).toBeLessThanOrEqual(400);
  });

  it("drops unknown context keys, keeping only the allowlist", async () => {
    const res = await handleFeedback(
      req("/api/feedback", {
        method: "POST",
        body: body({
          message: "context allowlist test",
          context: { route: "/radar/foo", evilPayload: "x".repeat(100000), theme: "dark" },
        }),
      }),
    );
    expect(res.status).toBe(201);
    const stored = rows[0].context as Record<string, unknown>;
    expect(stored).toEqual({ route: "/radar/foo", theme: "dark" });
  });
});

describe("pure helpers", () => {
  it("validateFeedback rejects empty/whitespace, non-string, and over-length messages", () => {
    expect(validateFeedback({ message: "" })).toEqual({ ok: false, error: "empty_message" });
    expect(validateFeedback({ message: "   " })).toEqual({ ok: false, error: "empty_message" });
    expect(validateFeedback({ message: 42 })).toEqual({ ok: false, error: "empty_message" });
    expect(validateFeedback({ message: undefined })).toEqual({ ok: false, error: "empty_message" });
    expect(validateFeedback({ message: "x".repeat(2001) })).toEqual({ ok: false, error: "message_too_long" });
    expect(validateFeedback({ message: "  ok  " })).toEqual({ ok: true, message: "ok" });
  });

  it("messageHash is deterministic and content-sensitive", () => {
    expect(messageHash("hello")).toBe(messageHash("hello"));
    expect(messageHash("hello")).not.toBe(messageHash("hellp"));
    expect(messageHash("hello")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("normalizeConsole caps entries and per-entry length, dropping malformed entries", () => {
    const out = normalizeConsole([
      { level: "warn", text: "ok" },
      { level: "error", text: "y".repeat(1000) },
      "not-an-object",
      { text: 42 },
      null,
    ]);
    expect(out.length).toBe(2);
    expect(out[0]).toEqual({ level: "warn", text: "ok" });
    expect(out[1].text.length).toBe(400);
  });

  it("normalizeConsole returns [] for a non-array", () => {
    expect(normalizeConsole("nope")).toEqual([]);
    expect(normalizeConsole(undefined)).toEqual([]);
  });
});
