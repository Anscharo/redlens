// Dev runner: a one-command local environment. First runs preflight() (Docker
// daemon up → Postgres container up + healthy → migrations → atlas artifacts),
// then starts the Bun API server (src/server/index.ts) and Vite together,
// prefixing each process's output with a colored [server] / [vite] label so the
// interleaved logs in `pnpm dev` are distinguishable. FORCE_COLOR keeps each
// tool's own colors alive even though we pipe their stdio through here.
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { preflight } from "./dev-preflight.mjs";

// The Bun children auto-load .env.local, but this Node runner does not — so pull
// it into process.env here too, letting the CHAT_ENABLED knob live in .env.local
// (not just an inline shell prefix). A missing file is fine.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

await preflight();

// Login features + chat are off by default (see vite.config.ts / config.ts).
// Two dev knobs, forwarded to both children (server reads USERS_ENABLED /
// CHAT_ENABLED, the Vite build reads the VITE_-prefixed pair):
//   USERS_ENABLED=1 (or VITE_USERS_ENABLED=1) → login features (auth, collections)
//   CHAT_ENABLED=1  (or VITE_CHAT_ENABLED=1)  → chat widget; implies users, since
//                                               chat needs a logged-in session
const truthy = (v) => v === "1" || v === "true";
const chat = truthy(process.env.CHAT_ENABLED) || truthy(process.env.VITE_CHAT_ENABLED);
const users = chat || truthy(process.env.USERS_ENABLED) || truthy(process.env.VITE_USERS_ENABLED);
const chatFlag = chat ? "1" : "0";
const usersFlag = users ? "1" : "0";

const procs = [
  { name: "server", color: "\x1b[36m", cmd: "bun", args: ["src/server/index.ts"], env: { CHAT_ENABLED: chatFlag, USERS_ENABLED: usersFlag } }, // cyan
  { name: "vite", color: "\x1b[35m", cmd: "vite", args: [], env: { VITE_CHAT_ENABLED: chatFlag, VITE_USERS_ENABLED: usersFlag } }, // magenta
];

const reset = "\x1b[0m";
const width = Math.max(...procs.map((p) => p.name.length));

const children = procs.map(({ name, color, cmd, args, env }) => {
  const label = `${color}[${name.padEnd(width)}]${reset} `;
  const child = spawn(cmd, args, {
    env: { ...process.env, FORCE_COLOR: "1", ...env },
    stdio: ["inherit", "pipe", "pipe"],
  });

  // Buffer until newline so a label is only ever prepended to a full line.
  const prefix = (stream, out) => {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk;
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) out.write(label + line + "\n");
    });
  };
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  return child;
});

let shuttingDown = false;
const killAll = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) c.kill("SIGTERM");
};

process.on("SIGINT", killAll);
process.on("SIGTERM", killAll);

// If either process exits, tear the other down and propagate the exit code.
for (const c of children) {
  c.on("exit", (code) => {
    killAll();
    process.exit(code ?? 0);
  });
}
