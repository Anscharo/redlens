// Type declarations for the atlas worker's step registry (index.mjs), so the
// registry test can import it. Runtime stays index.mjs.
export interface WorkerContext {
  db: unknown;
  full: boolean;
  noFetch: boolean;
  env: Record<string, string | undefined>;
  runAsync: (cmd: string, args: string[], opts?: { env?: Record<string, string | undefined> }) => Promise<void>;
  log: (line: string) => void;
  warn: (line: string) => void;
}
export interface WorkerStep {
  /** Stable short id; a tail lane's id is also its failure label. */
  id: string;
  /** "tick": sequential, before the drift check. "tail": parallel, after the heartbeat. */
  phase: "tick" | "tail";
  /** Tick steps: the "<label> skipped — …" warning label. */
  label?: string;
  /** Tick steps that need the network: the line logged instead of running under --no-fetch. */
  skipWhenNoFetch?: string;
  /** Tick: resolves to the log line. Tail: the child's promise. */
  run(ctx: WorkerContext): Promise<string | void>;
}
export const WORKER_STEPS: WorkerStep[];
export function stepsIn(steps: WorkerStep[], phase: WorkerStep["phase"]): WorkerStep[];
export function runTickSteps(steps: WorkerStep[], ctx: WorkerContext): Promise<void>;
export function runTailSteps(steps: WorkerStep[], ctx: WorkerContext): Promise<void>;
