// feedback.ts unit tests. Mocks ./db.ts COMPLETELY (mirrors collections.test.ts's
// convention) with a tiny in-memory `feedback` row array. session.ts is NOT
// mocked — a real signed JWT drives the signed-in path, and a near-expiry one
// (mirrors conversations.test.ts's nearExpiryToken) exercises the sliding-
// window refresh branch.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { toUuidArrayLiteral, fromUuidArray } from "./pg-array.ts";
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

  // rateLimitAndDedupe issues two shapes — `WHERE user_id = $2` when signed in,
  // `WHERE user_id IS NULL AND submitter_key = $2` when anonymous — so the
  // existing indexes apply (a COALESCE predicate planned a Seq Scan). Both
  // carry the same params; the key is a user id in one and a cookie in the
  // other, which is exactly what rateKeyOf() reconstructs per row.
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
  // Real impls, never re-stubbed: `Array.isArray("{uuid,uuid}")` is false, so a
  // hand-rolled stub silently returns [] for what Bun.sql actually hands back.
  // See pg-array.ts; enforced by scripts/aux/audit-mock-modules.mjs.
  toUuidArrayLiteral,
  fromUuidArray,
}));

// Captured PostHog survey-mirror events. The real captureServerEvent is a
// fire-and-forget fetch; here it just records so the emitted property names
// can be asserted.
let captured: { event: string; distinctId: string; props: Record<string, unknown> }[] = [];
mock.module("./posthog-capture.ts", () => ({
  serverAnalyticsEnabled: true,
  captureServerEvent: (event: string, distinctId: string, props: Record<string, unknown> = {}) => {
    captured.push({ event, distinctId, props });
  },
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
  captured = [];
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
      req("/api/feedback", { method: "POST", body: body({ message: "the sidebar is broken", elapsedMs: 9000 }) }),
    );
    expect(res1.status).toBe(201);
    const setCookie1 = res1.headers.getSetCookie().find((c) => c.startsWith("rl_fb="));
    expect(setCookie1).toBeDefined();
    const value1 = setCookie1!.split(";")[0].split("=")[1];

    const res2 = await handleFeedback(
      req("/api/feedback", {
        method: "POST",
        fbCookie: value1,
        body: body({ message: "a second, different report", elapsedMs: 9000 }),
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
      req("/api/feedback", { method: "POST", sessionCookie: token, body: body({ message: "chart is off by one", elapsedMs: 9000 }) }),
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

  // The floor has to FAIL CLOSED. Our own client always computes elapsedMs, so
  // a request without it is by definition hand-rolled — exactly the traffic
  // this layer exists to stop. An earlier version guarded on
  // `typeof === "number"`, which let a bot skip the check by simply omitting
  // the field.
  it("200s silently with no insert when elapsedMs is omitted entirely", async () => {
    const res = await handleFeedback(
      req("/api/feedback", { method: "POST", body: body({ message: "no elapsed field at all" }) }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(rows.length).toBe(0);
  });

  it("200s silently for a non-numeric or non-finite elapsedMs", async () => {
    for (const elapsedMs of ["9000", null, Number.NaN, Number.POSITIVE_INFINITY]) {
      rows = [];
      const res = await handleFeedback(
        req("/api/feedback", { method: "POST", body: body({ message: "forged elapsed", elapsedMs }) }),
      );
      expect(res.status).toBe(200);
      expect(rows.length).toBe(0);
    }
  });

  it("still accepts a genuine slow submission", async () => {
    const res = await handleFeedback(
      req("/api/feedback", { method: "POST", body: body({ message: "a real human report", elapsedMs: 9000 }) }),
    );
    expect(res.status).toBe(201);
    expect(rows.length).toBe(1);
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
        body: body({ message: "one too many", elapsedMs: 9000 }),
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
        body: body({ message: "signed-in user, different limit", elapsedMs: 9000 }),
      }),
    );
    expect(res.status).toBe(201);
  });
});

describe("dedupe", () => {
  it("the same message twice within 10 minutes yields exactly one row", async () => {
    const payload = body({ message: "duplicate double-click report", elapsedMs: 9000 });
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
        body: body({ message: "console spam report", console: bigConsole, elapsedMs: 9000 }),
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
          elapsedMs: 9000,
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

// The survey mirror is fire-and-forget (`void (async () => …)()`), so the 201
// resolves before the capture runs — yield once before asserting.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("posthog survey mirror", () => {
  const origId = config.feedbackSurveyId;
  const origQuestion = config.feedbackSurveyQuestion;
  const QUESTION = "7ce5b831-dc71-4648-b6b0-b583d48a0c11";

  afterEach(() => {
    config.feedbackSurveyId = origId;
    config.feedbackSurveyQuestion = origQuestion;
  });

  async function submit(message: string) {
    const res = await handleFeedback(
      req("/api/feedback", { method: "POST", body: body({ message, elapsedMs: 9000 }) }),
    );
    expect(res.status).toBe(201);
    await flush();
  }

  // Every successful submit also emits the unconditional `feedback_received`
  // receipt, so these assertions select the mirror by event name rather than
  // by position — the two are independent and must not be coupled.
  const surveys = () => captured.filter((c) => c.event === "survey sent");

  it("keys the response by question id when one is configured", async () => {
    config.feedbackSurveyId = "survey-uuid";
    config.feedbackSurveyQuestion = QUESTION;

    await submit("a report that should reach posthog");

    expect(surveys()).toHaveLength(1);
    expect(surveys()[0].props.$survey_id).toBe("survey-uuid");
    expect(surveys()[0].props[`$survey_response_${QUESTION}`]).toBe("a report that should reach posthog");
  });

  // Regression: the key used to be interpolated unconditionally, so an empty
  // question id produced a property literally named `$survey_response_`.
  // PostHog accepts that event, so ph_sent flips true and nothing errors —
  // but the answer is unreadable in the Responses tab. Silent, and it looks
  // like it is working.
  it("never emits a bare `$survey_response_` with an empty question id", async () => {
    config.feedbackSurveyId = "survey-uuid";
    config.feedbackSurveyQuestion = "";

    await submit("no question id configured");

    expect(surveys()).toHaveLength(1);
    const keys = Object.keys(surveys()[0].props);
    expect(keys).not.toContain("$survey_response_");
    expect(keys.some((k) => k.startsWith("$survey_response_"))).toBe(false);
    // Falls back to the legacy un-suffixed property, valid for one question.
    expect(surveys()[0].props.$survey_response).toBe("no question id configured");
  });

  it("skips the mirror entirely when no survey is configured, but still writes the row", async () => {
    config.feedbackSurveyId = "";
    config.feedbackSurveyQuestion = "";

    await submit("survey off — postgres is still the record");

    expect(surveys()).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toBe("survey off — postgres is still the record");
  });

  it("marks the row ph_sent once the mirror has fired", async () => {
    config.feedbackSurveyId = "survey-uuid";
    config.feedbackSurveyQuestion = QUESTION;

    await submit("flips ph_sent");

    expect(rows).toHaveLength(1);
    expect(rows[0].ph_sent).toBe(true);
  });
});

// The `feedback_received` receipt is what the PostHog "new feedback" alert
// watches, so its fidelity IS the feature: it must fire on every real row and
// on nothing else. The client's own `feedback_submitted` cannot do this job —
// it fires on the silent-200 paths below and is lost to ad blockers.
describe("posthog receipt (feedback_received)", () => {
  const receipts = () => captured.filter((c) => c.event === "feedback_received");

  async function post(obj: Record<string, unknown>) {
    return handleFeedback(req("/api/feedback", { method: "POST", body: body(obj) }));
  }

  it("fires on a real insert even with no survey configured", async () => {
    config.feedbackSurveyId = "";

    const res = await post({ message: "something is broken", elapsedMs: 9000, url: "http://x/atlas" });

    expect(res.status).toBe(201);
    expect(rows).toHaveLength(1);
    expect(receipts()).toHaveLength(1);
    expect(receipts()[0].props.chars).toBe("something is broken".length);
    expect(receipts()[0].props.url).toBe("http://x/atlas");
    expect(receipts()[0].props.signed_in).toBe(false);
  });

  // Postgres is the record; the alert only needs to know a row arrived. Sending
  // the text would put a bug reporter's words in a second system for nothing.
  it("carries no message text", async () => {
    await post({ message: "a very distinctive complaint", elapsedMs: 9000 });

    const serialized = JSON.stringify(receipts()[0].props);
    expect(serialized).not.toContain("a very distinctive complaint");
  });

  // Each of these 200s WITHOUT inserting. A receipt here would page us for
  // feedback that does not exist — precisely the client event's failure mode.
  it("stays silent on a honeypot submission", async () => {
    const res = await post({ message: "spam", website: "http://spam.example", elapsedMs: 9000 });

    expect(res.status).toBe(200);
    expect(rows).toHaveLength(0);
    expect(receipts()).toHaveLength(0);
  });

  it("stays silent on a submission under the timing floor", async () => {
    const res = await post({ message: "too fast to be human", elapsedMs: 200 });

    expect(res.status).toBe(200);
    expect(rows).toHaveLength(0);
    expect(receipts()).toHaveLength(0);
  });

  // Dedupe is keyed on the submitter cookie, so both posts must carry the same
  // one — a fresh request mints a new key and would legitimately insert twice.
  it("stays silent on a deduped resubmission, having fired once for the original", async () => {
    const dbl = () =>
      handleFeedback(
        req("/api/feedback", {
          method: "POST",
          body: body({ message: "double-clicked", elapsedMs: 9000 }),
          fbCookie: "same-submitter",
        }),
      );

    expect((await dbl()).status).toBe(201);
    expect((await dbl()).status).toBe(200);

    expect(rows).toHaveLength(1);
    expect(receipts()).toHaveLength(1);
  });
});

describe("context.interactions — the one allowlisted array", () => {
  it("survives the allowlist and reaches the row", async () => {
    const trail = ["just now: button#send", "5s ago: a [href=/reports]"];
    const res = await handleFeedback(
      req("/api/feedback", {
        method: "POST",
        body: body({ message: "trail rides along", elapsedMs: 9000, context: { interactions: trail } }),
      }),
    );
    expect(res.status).toBe(201);
    expect((rows[0].context as { interactions: string[] }).interactions).toEqual(trail);
  });

  it("clamps a flood of entries to 5 and each entry to 160 chars", async () => {
    const res = await handleFeedback(
      req("/api/feedback", {
        method: "POST",
        body: body({
          message: "oversized trail",
          elapsedMs: 9000,
          context: { interactions: Array.from({ length: 20 }, () => "x".repeat(1000)) },
        }),
      }),
    );
    expect(res.status).toBe(201);
    const trail = (rows[0].context as { interactions: string[] }).interactions;
    expect(trail).toHaveLength(5);
    for (const entry of trail) expect(entry.length).toBe(160);
  });

  it("drops non-string members rather than storing them", async () => {
    await handleFeedback(
      req("/api/feedback", {
        method: "POST",
        body: body({
          message: "mixed trail members",
          elapsedMs: 9000,
          context: { interactions: ["ok", { evil: "obj" }, 42, null] },
        }),
      }),
    );
    expect((rows[0].context as { interactions: string[] }).interactions).toEqual(["ok"]);
  });

  it("drops the key entirely when it isn't an array — scalars must not sneak through", async () => {
    await handleFeedback(
      req("/api/feedback", {
        method: "POST",
        body: body({ message: "not an array", elapsedMs: 9000, context: { interactions: "nope" } }),
      }),
    );
    expect(rows[0].context).not.toHaveProperty("interactions");
  });
});
