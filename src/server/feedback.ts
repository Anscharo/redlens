// POST /api/feedback — free-text bug reports from any page, anonymous or
// signed-in. Unlike collections.ts/chat.ts this route is NOT auth-gated:
// getSessionUser is consulted but a missing/invalid session never 401s.
// Anti-spam (honeypot, timing floor, Postgres-backed rate limits + dedupe,
// global circuit breaker — all in feedback-limits.ts) carries the real weight
// here since there's no login wall to lean on.
import { sql } from "./db.ts";
import { getSessionUser, parseCookies } from "./session.ts";
import { json, isNonEmptyString } from "./http.ts";
import { redact } from "../lib/redact.ts";
import { config } from "./config.ts";
import { captureServerEvent } from "./posthog-capture.ts";
import {
  buildContext,
  messageHash,
  normalizeConsole,
  str,
  validateFeedback,
  MAX_MESSAGE_LEN,
  TIMING_FLOOR_MS,
  type FeedbackBody,
} from "./feedback-validate.ts";
import {
  FB_COOKIE,
  feedbackCookie,
  globalCountToday,
  rateLimitAndDedupe,
  rateLimited,
} from "./feedback-limits.ts";

export async function handleFeedback(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // Read the real body size FIRST — never trust Content-Length, which is
  // client-controlled and absent on a chunked request.
  const text = await req.text();
  if (Buffer.byteLength(text) > config.feedbackMaxBytes) {
    return json({ error: "payload_too_large" }, 413);
  }
  let body: FeedbackBody;
  try {
    body = JSON.parse(text) as FeedbackBody;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const validated = validateFeedback(body);
  if (!validated.ok) return json({ error: validated.error }, 400);

  // Honeypot: a hidden field a bot fills but a real user never sees. ALWAYS
  // 200 with no insert — a 4xx would teach the bot which field tripped it.
  if (isNonEmptyString(body.website)) return json({ ok: true }, 200);

  // Timing floor: no human reads the form and submits inside 1.5s. Same
  // silent-200-no-insert treatment as the honeypot.
  //
  // FAILS CLOSED, deliberately: a missing or non-finite elapsedMs counts as
  // too fast. FeedbackModal always sends Date.now() - openedAt, so a request
  // without it is by definition hand-rolled — exactly the traffic this layer
  // exists to stop. Guarding on `typeof === "number"` would let a bot skip the
  // check by omitting the field. Number.isFinite also rejects NaN, Infinity
  // (which would pass a bare `<`), and a negative value from a forged clock.
  // Any future non-browser caller must send it; that is the intended contract.
  if (!Number.isFinite(body.elapsedMs) || (body.elapsedMs as number) < TIMING_FLOOR_MS) {
    return json({ ok: true }, 200);
  }

  // Optional session — feedback must work signed-out, so this NEVER 401s.
  const session = await getSessionUser(req);
  const userId = session?.user.id ?? null;

  // Reattach (or mint) the submitter cookie. Only ever set on THIS route's
  // POST response — readers elsewhere must stay cookieless.
  const existingCookie = parseCookies(req.headers.get("cookie"))[FB_COOKIE];
  const submitterKey = existingCookie || crypto.randomUUID();
  const cookies = [...(session?.refresh ? [session.refresh] : []), feedbackCookie(submitterKey)];

  const hash = messageHash(validated.message);

  try {
    const globalN = await globalCountToday();
    if (globalN >= config.feedbackGlobalPerDay) return rateLimited(86_400);

    const { hourly, daily, dupe } = await rateLimitAndDedupe(userId, submitterKey, hash);
    // Dedupe: same message from the same submitter inside 10 minutes (a
    // double-click, or the dumbest spam loop) — 200, no second insert.
    if (dupe > 0) return json({ ok: true }, 200, cookies);

    const hourLimit = userId ? config.feedbackUserPerHour : config.feedbackAnonPerHour;
    const dayLimit = userId ? config.feedbackUserPerDay : config.feedbackAnonPerDay;
    if (hourly >= hourLimit) return rateLimited(3_600);
    if (daily >= dayLimit) return rateLimited(86_400);

    // if (config.turnstileSecret) { … } — seam for a future Cloudflare
    // Turnstile escalation, once anon volume warrants it.

    // Re-clamp + redact authoritatively. The client applies equivalent caps
    // before sending; these are the ones that count.
    const message = redact(validated.message.slice(0, MAX_MESSAGE_LEN));
    const consoleEntries = normalizeConsole(body.console).map((e) => ({ ...e, text: redact(e.text) }));
    const context = buildContext(body.context);

    const rows = (await sql`
      INSERT INTO feedback (
        user_id, submitter_key, message, message_hash,
        url, host, app_commit, atlas_commit, atlas_base, preview_id,
        node_id, session_id, user_agent, context, console
      ) VALUES (
        ${userId}, ${submitterKey}, ${message}, ${hash},
        ${str(body.url)}, ${str(body.host)}, ${str(body.appCommit)}, ${str(body.atlasCommit)},
        ${str(body.atlasBase)}, ${str(body.previewId)}, ${str(body.nodeId)}, ${str(body.sessionId)},
        ${req.headers.get("user-agent")}, ${context}::jsonb, ${consoleEntries}::jsonb
      ) RETURNING id
    `) as { id: string }[];
    const id = rows[0].id;

    // Unconditional server-side receipt — the event the "new feedback" PostHog
    // alert watches. Deliberately NOT the client's own `feedback_submitted`
    // (FeedbackModal.tsx), which fires on the silent-200 paths too (honeypot /
    // too-fast / duplicate) and is lost to ad blockers, so it can neither
    // confirm nor count real rows. Distinct event name on purpose: reusing the
    // client's would double-count every real submission and leave the alert
    // and the open→submit funnel disagreeing. Unlike forwardToPosthog below
    // this needs no config — a feedback tool nobody watches is the failure
    // mode it exists to prevent. Carries no message text: Postgres is the
    // record, and the alert only needs to know something arrived.
    captureServerEvent("feedback_received", str(body.sessionId) ?? submitterKey, {
      chars: message.length,
      url: str(body.url),
      node_id: str(body.nodeId),
      signed_in: Boolean(userId),
      app_commit: config.appCommit || null,
    });

    forwardToPosthog(id, message, body, submitterKey);
    return json({ ok: true, id }, 201, cookies);
  } catch (e) {
    console.error(`feedback: insert failed: ${(e as Error).message}`);
    return json({ error: "server_error" }, 500);
  }
}

// Fire-and-forget PostHog Surveys mirror, wrapped so a capture/update failure
// can never fail (or slow) the already-successful 201. Runs only AFTER the
// rate-limit and global-cap checks cleared, so it can never become an
// amplification vector. Skipped entirely — row still written — when no survey
// is configured, which is the default and the case in local dev.
function forwardToPosthog(id: string, message: string, body: FeedbackBody, submitterKey: string): void {
  if (!config.feedbackSurveyId) return;
  const distinctId = str(body.sessionId) ?? submitterKey;
  // PostHog keys a survey answer by question id. A single-question survey can
  // use the legacy un-suffixed property instead, so the question id stays
  // optional. Never interpolate an empty id: `$survey_response_` is accepted
  // by PostHog but unreadable in the Responses tab — it fails silently, which
  // is why this branch exists rather than a template literal.
  const responseKey = config.feedbackSurveyQuestion
    ? `$survey_response_${config.feedbackSurveyQuestion}`
    : "$survey_response";
  void (async () => {
    try {
      captureServerEvent("survey sent", distinctId, {
        $survey_id: config.feedbackSurveyId,
        [responseKey]: message,
        url: str(body.url),
        node_id: str(body.nodeId),
      });
      await sql`UPDATE feedback SET ph_sent = true WHERE id = ${id}`;
    } catch (e) {
      console.error(`feedback: posthog forward failed for ${id}: ${(e as Error).message}`);
    }
  })();
}
