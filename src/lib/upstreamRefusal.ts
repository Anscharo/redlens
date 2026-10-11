// What says "too fast", as upstreamBackoff.ts reads an answer or an error: an
// HTTP 429; a 403 that GitHub marks as an exhausted rate limit; or a short
// JSON body that says so: a JSON-RPC error with code 429 or -32005, a message
// naming a rate limit, or an explorer's NOTOK whose text names one. In an
// error's text a status or code must be labelled as one ("HTTP 429", viem's
// "Status: 429", "code -32005"), because a bare 429 can be a block number or
// an id in the request a client echoes back. Providers also answer a query
// asking for too much (too many results, too wide a block range) with -32005;
// that is the request's fault, not the pace's, so it never starts a cooldown.
export const RATE_LIMITED = /\b(?:http|status|code)\W{0,2}(?:429|-32005)\b|rate.?limit|max calls per sec|too many requests|cooling down/i;
const QUERY_TOO_LARGE = /more than [\d,]+ results|block range|range (?:is )?too|response size|too large/i;
export const limitedText = (m: string) => RATE_LIMITED.test(m) && !QUERY_TOO_LARGE.test(m);
export const isRateLimited = (e: unknown) => limitedText(e instanceof Error ? e.message : String(e));

/** A JSON body longer than this is data, not a refusal: rate-limit answers are a line or two. */
const REFUSAL_MAX_BYTES = 4_096;

/**
 * A JSON body of at most REFUSAL_MAX_BYTES, read from a clone; null for a
 * longer one, which is abandoned as soon as it passes the limit, so an explorer
 * page or a multicall result is never buffered or parsed a second time. A
 * declared length is trusted only when the body is not compressed.
 */
async function shortJson(res: Response): Promise<Record<string, unknown> | null> {
  if (!res.headers.get("content-encoding") && Number(res.headers.get("content-length") ?? 0) > REFUSAL_MAX_BYTES) return null;
  const reader = res.clone().body?.getReader();
  if (!reader) return null;
  const bytes = new Uint8Array(REFUSAL_MAX_BYTES);
  let n = 0;
  try {
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      if (n + r.value.length > REFUSAL_MAX_BYTES) {
        // A tee'd branch's cancel settles only once the other branch is cancelled too, so it is not awaited.
        reader.cancel().catch(() => {});
        return null;
      }
      bytes.set(r.value, n);
      n += r.value.length;
    }
    return JSON.parse(new TextDecoder().decode(bytes.subarray(0, n))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Whether a response says the caller is going too fast. */
export async function refused(res: Response): Promise<boolean> {
  if (res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")) return true;
  if (!(res.headers.get("content-type") ?? "").includes("json")) return false;
  const body = await shortJson(res);
  const err = body?.error as { code?: number; message?: string } | undefined;
  const errText = String(err?.message ?? "");
  if (err && (err.code === 429 || (err.code === -32005 && !QUERY_TOO_LARGE.test(errText)) || limitedText(errText))) return true;
  if (res.status === 403 && limitedText(String(body?.message ?? ""))) return true;
  return body?.message === "NOTOK" && limitedText(String(body.result ?? ""));
}

/** How long the host asked us to wait: Retry-After, else the seconds until GitHub's X-RateLimit-Reset when the limit is spent. */
export function askedWait(res: Response): string | null {
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  if (res.headers.get("retry-after") || res.headers.get("x-ratelimit-remaining") !== "0" || !reset) return res.headers.get("retry-after");
  return String(Math.max(0, reset - Math.floor(Date.now() / 1000)));
}

