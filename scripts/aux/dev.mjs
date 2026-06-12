// Dev runner: starts the Bun API server (src/server/index.ts) and Vite
// together, prefixing each process's output with a colored [server] / [vite]
// label so the interleaved logs in `pnpm dev` are distinguishable. Replaces the
// old inline `bun … & vite & wait` script. FORCE_COLOR keeps each tool's own
// colors alive even though we pipe their stdio through here.
import { spawn } from "node:child_process";

// Chat + auth are off by default (see vite.config.ts / src/server/config.ts).
// One dev knob lights up both halves: set CHAT_ENABLED=1 or VITE_CHAT_ENABLED=1
// and dev.mjs forwards the right flag to each child (server reads CHAT_ENABLED,
// the Vite build reads VITE_CHAT_ENABLED).
const truthy = (v) => v === "1" || v === "true";
const chat = truthy(process.env.CHAT_ENABLED) || truthy(process.env.VITE_CHAT_ENABLED);
const flag = chat ? "1" : "0";

const procs = [
  { name: "server", color: "\x1b[36m", cmd: "bun", args: ["src/server/index.ts"], env: { CHAT_ENABLED: flag } }, // cyan
  { name: "vite", color: "\x1b[35m", cmd: "vite", args: [], env: { VITE_CHAT_ENABLED: flag } }, // magenta
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
