#!/usr/bin/env bun
// Load-test runner (Bun). Off the `pnpm build` chain.
//
//   bun scripts/aux/load/run.mjs health
//   bun scripts/aux/load/run.mjs sse
//   bun scripts/aux/load/run.mjs rps
//   bun scripts/aux/load/run.mjs chat
//   bun scripts/aux/load/run.mjs chat-unauth
//   bun scripts/aux/load/run.mjs oom-headroom
//
// Env: BASE, HOLD_MS, RSS_ABORT_MB, HEALTH_P95_MS, CHAT_COOKIE, STEPS, RPS, OUT
import { writeFileSync } from "node:fs";

const BASE = (process.env.BASE || "https://redlens-development.up.railway.app").replace(/\/$/, "");
const RSS_ABORT_MB = Number(process.env.RSS_ABORT_MB || 850);
const HEALTH_P95_MS = Number(process.env.HEALTH_P95_MS || 2000);
const HOLD_MS = Number(process.env.HOLD_MS || 45_000);
const OUT = process.env.OUT || "";

const cmd = process.argv[2] || "health";

function pct(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

async function getHealth() {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/health`);
  const ms = performance.now() - t0;
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ms, body };
}

function abortFromHealth(samples) {
  const fails = samples.filter((s) => s.status !== 200).length;
  const errRate = samples.length ? fails / samples.length : 0;
  const p95 = pct([...samples.map((s) => s.ms)].sort((a, b) => a - b), 95);
  const last = samples.at(-1);
  const rss = last?.body?.rss_mb;
  const reasons = [];
  if (errRate > 0.05) reasons.push(`health error rate ${(errRate * 100).toFixed(1)}% > 5%`);
  if (p95 != null && p95 > HEALTH_P95_MS) reasons.push(`health p95 ${p95.toFixed(0)}ms > ${HEALTH_P95_MS}ms`);
  if (typeof rss === "number" && rss >= RSS_ABORT_MB) reasons.push(`rss_mb ${rss} >= ${RSS_ABORT_MB}`);
  return { errRate, p95, rss, sse_clients: last?.body?.sse_clients, abort: reasons.length ? reasons.join("; ") : null };
}

async function holdOneSse(ms, signal) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/atlas-events`, {
    signal,
    headers: { accept: "text/event-stream" },
  });
  if (!res.ok || !res.body) {
    return { ok: false, status: res.status, ms: performance.now() - t0, bytes: 0, pings: 0 };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let bytes = 0;
  let pings = 0;
  const deadline = Date.now() + ms;
  try {
    while (Date.now() < deadline && !signal.aborted) {
      const remaining = Math.max(1, deadline - Date.now());
      const chunk = await Promise.race([
        reader.read(),
        new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), remaining)),
      ]);
      if (chunk.timeout) break;
      if (chunk.done) break;
      const n = chunk.value?.byteLength ?? 0;
      bytes += n;
      buf += decoder.decode(chunk.value, { stream: true });
      if (buf.includes(":ping")) {
        pings += (buf.match(/:ping/g) || []).length;
        buf = buf.slice(buf.lastIndexOf(":ping") + 5);
      }
    }
    await reader.cancel().catch(() => {});
    return { ok: true, status: res.status, ms: performance.now() - t0, bytes, pings };
  } catch (e) {
    return { ok: false, status: 0, ms: performance.now() - t0, bytes, pings, error: String(e?.message || e) };
  }
}

async function runSse() {
  const steps = (process.env.STEPS || "10,25,50,100,150,250")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => n > 0);
  const report = { experiment: "sse-hold", base: BASE, hold_ms: HOLD_MS, steps: [] };
  console.log(`sse-hold BASE=${BASE} HOLD_MS=${HOLD_MS} steps=${steps.join(",")}`);

  for (const n of steps) {
    const ac = new AbortController();
    const healthSamples = [];
    const healthTimer = setInterval(() => {
      getHealth().then((h) => healthSamples.push(h)).catch((e) => healthSamples.push({ status: 0, ms: 0, body: { error: String(e) } }));
    }, 2000);
    const t0 = performance.now();
    const holds = await Promise.allSettled(
      Array.from({ length: n }, () => holdOneSse(HOLD_MS, ac.signal)),
    );
    clearInterval(healthTimer);
    ac.abort();
    const results = holds.map((h) => (h.status === "fulfilled" ? h.value : { ok: false, error: String(h.reason) }));
    const ok = results.filter((r) => r.ok).length;
    const fail = results.length - ok;
    const withPing = results.filter((r) => r.pings > 0).length;
    const health = abortFromHealth(healthSamples.length ? healthSamples : [await getHealth()]);
    const row = {
      target: n,
      ok,
      fail,
      with_heartbeat: withPing,
      elapsed_ms: Math.round(performance.now() - t0),
      health,
    };
    report.steps.push(row);
    console.log(JSON.stringify(row));
    if (health.abort || fail / n > 0.1) {
      report.stopped = health.abort || `sse fail rate ${fail}/${n} > 10%`;
      report.last_green = report.steps.filter((s) => !s.health.abort && s.fail / s.target <= 0.1).at(-1)?.target ?? 0;
      report.first_red = n;
      writeOut(report);
      console.error(`STOP ${report.stopped}`);
      return report;
    }
  }
  report.last_green = steps.at(-1);
  report.first_red = null;
  writeOut(report);
  return report;
}

async function runRps() {
  const rates = (process.env.RATES || "10,20,50").split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
  const durationMs = Number(process.env.RPS_MS || 20_000);
  const report = { experiment: "http-rps", base: BASE, duration_ms: durationMs, steps: [] };
  console.log(`http-rps BASE=${BASE} rates=${rates.join(",")} rps for ${durationMs}ms each`);

  for (const rps of rates) {
    const healthSamples = [];
    const healthTimer = setInterval(() => {
      getHealth().then((h) => healthSamples.push(h)).catch(() => {});
    }, 2000);
    const latencies = [];
    let ok = 0;
    let fail = 0;
    const tEnd = Date.now() + durationMs;
    const interval = 1000 / rps;
    const inflight = [];
    while (Date.now() < tEnd) {
      const started = Date.now();
      inflight.push(
        (async () => {
          const t0 = performance.now();
          try {
            const res = await fetch(`${BASE}/`);
            const ms = performance.now() - t0;
            latencies.push(ms);
            if (res.status === 200) ok++;
            else fail++;
            await res.body?.cancel?.();
          } catch {
            fail++;
            latencies.push(performance.now() - t0);
          }
        })(),
      );
      const wait = interval - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
    await Promise.all(inflight);
    clearInterval(healthTimer);
    latencies.sort((a, b) => a - b);
    const health = abortFromHealth(healthSamples.length ? healthSamples : [await getHealth()]);
    const row = {
      rps,
      ok,
      fail,
      p50_ms: pct(latencies, 50),
      p95_ms: pct(latencies, 95),
      health,
    };
    report.steps.push(row);
    console.log(JSON.stringify(row));
    if (health.abort) {
      report.stopped = health.abort;
      writeOut(report);
      return report;
    }
  }
  writeOut(report);
  return report;
}

async function postChat(cookie, message, timeoutMs) {
  const t0 = performance.now();
  const headers = { "content-type": "application/json", accept: "text/event-stream" };
  if (cookie) headers.cookie = cookie;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ message }),
      signal: ac.signal,
    });
    const text = await res.text();
    return {
      status: res.status,
      ms: performance.now() - t0,
      body_head: text.slice(0, 240),
      sse: res.headers.get("content-type")?.includes("event-stream") ?? false,
    };
  } catch (e) {
    return { status: 0, ms: performance.now() - t0, error: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

async function runChatUnauth(n = Number(process.env.N || 20)) {
  const report = { experiment: "chat-unauth", base: BASE, n, results: [] };
  const inflight = Array.from({ length: n }, () => postChat("", "hi", 10_000));
  const results = await Promise.all(inflight);
  const byStatus = {};
  for (const r of results) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    report.results.push({ status: r.status, ms: Math.round(r.ms) });
  }
  report.by_status = byStatus;
  const health = await getHealth();
  report.health_after = { status: health.status, rss_mb: health.body.rss_mb, ms: health.ms };
  console.log(JSON.stringify({ by_status: byStatus, health_after: report.health_after }));
  writeOut(report);
  return report;
}

async function runChat() {
  const cookie = process.env.CHAT_COOKIE || "";
  if (!cookie) {
    console.warn("CHAT_COOKIE unset — running unauthenticated probe only (expect 401).");
    return runChatUnauth();
  }
  const steps = (process.env.STEPS || "1,2,5").split(",").map((s) => Number(s.trim())).filter((n) => n > 0);
  const message = process.env.CHAT_MESSAGE || "say hi in one short sentence";
  const timeoutMs = Number(process.env.CHAT_TIMEOUT_MS || 30_000);
  const report = { experiment: "chat", base: BASE, steps: [] };
  for (const n of steps) {
    const healthBefore = await getHealth();
    const t0 = performance.now();
    const results = await Promise.all(Array.from({ length: n }, () => postChat(cookie, message, timeoutMs)));
    const healthAfter = await getHealth();
    const byStatus = {};
    for (const r of results) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    const row = {
      concurrent: n,
      by_status: byStatus,
      elapsed_ms: Math.round(performance.now() - t0),
      rss_before: healthBefore.body.rss_mb,
      rss_after: healthAfter.body.rss_mb,
      health_p95_proxy_ms: healthAfter.ms,
      sample: results[0],
    };
    report.steps.push(row);
    console.log(JSON.stringify(row));
    const health = abortFromHealth([healthAfter]);
    if (health.abort) {
      report.stopped = health.abort;
      writeOut(report);
      return report;
    }
  }
  writeOut(report);
  return report;
}

async function runOomHeadroom() {
  // Destructive OOM is forbidden on the shared development singleton.
  // Hold a moderate SSE count + poll RSS; abort at 85% of a 1 GB plan.
  const n = Number(process.env.SSE_N || 50);
  const ms = Number(process.env.HOLD_MS || 60_000);
  console.log(`oom-headroom: holding ${n} SSE for ${ms}ms; abort at rss_mb>=${RSS_ABORT_MB}. Will not force OOM.`);
  const before = await getHealth();
  const ac = new AbortController();
  const healthSamples = [before];
  const healthTimer = setInterval(() => {
    getHealth().then((h) => healthSamples.push(h)).catch(() => {});
  }, 2000);
  await Promise.allSettled(Array.from({ length: n }, () => holdOneSse(ms, ac.signal)));
  clearInterval(healthTimer);
  ac.abort();
  const after = await getHealth();
  const rssValues = healthSamples.map((s) => s.body?.rss_mb).filter((x) => typeof x === "number");
  const report = {
    experiment: "oom-headroom",
    base: BASE,
    note: "Shared development must not be OOMed. This records headroom under moderate SSE hold. Force-kill only on a throwaway replica.",
    sse_held: n,
    rss_mb_before: before.body.rss_mb ?? null,
    rss_mb_after: after.body.rss_mb ?? null,
    rss_mb_max: rssValues.length ? Math.max(...rssValues) : null,
    sse_clients_peak: healthSamples.map((s) => s.body?.sse_clients).filter((x) => typeof x === "number").reduce((a, b) => Math.max(a, b), 0) || null,
    expected_on_oom: {
      process: "kernel/Railway kills the container when RSS exceeds the plan slider",
      health: "/api/health fails (process down)",
      restart: "railway.toml restartPolicyType=ON_FAILURE, maxRetries=3",
      clients: "in-flight SSE and chat streams drop; EventSource reconnects after boot",
      after_boot: "serves baked dist/ atlas then hot-swaps from Postgres",
      no_graceful_handler: true,
    },
    abort: abortFromHealth(healthSamples),
  };
  console.log(JSON.stringify(report, null, 2));
  writeOut(report);
  return report;
}

function writeOut(report) {
  if (!OUT) return;
  writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
}

const health = async () => {
  const h = await getHealth();
  const row = {
    experiment: "baseline",
    base: BASE,
    status: h.status,
    ms: Math.round(h.ms),
    body: h.body,
    replica_note: "Web service is replicas=1 by design (in-process updater + in-memory indexes). Do not scale out.",
    memory_note: "DEPLOYMENT.md documents ~1 GB; confirm the Railway Settings slider. Abort load tests at rss_mb>=850 if that field is present.",
  };
  console.log(JSON.stringify(row, null, 2));
  writeOut(row);
  return row;
};

const fns = {
  health,
  sse: runSse,
  rps: runRps,
  chat: runChat,
  "chat-unauth": runChatUnauth,
  "oom-headroom": runOomHeadroom,
};

if (!fns[cmd]) {
  console.error(`unknown command ${cmd}; expected ${Object.keys(fns).join("|")}`);
  process.exit(2);
}

const report = await fns[cmd]();
if (report?.stopped) process.exit(1);
