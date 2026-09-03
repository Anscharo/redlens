// Type surface for the exported helpers of e2e-gate.mjs (the polling CLI body is
// guarded behind isMain and not typed). Consumed by scripts_tests/e2e-gate.test.ts.

/** What one e2e.yml run at a commit contributes to the gate's verdict. */
export interface E2eWorkflowRun {
  status?: string | null;
  conclusion?: string | null;
  html_url?: string | null;
}

export interface E2eVerdict {
  /** pass = mirror a green run; fail = mirror a red one; wait = poll again. */
  verdict: "pass" | "fail" | "wait";
  reason: string;
  runUrl?: string | null;
}

/** Conclusions that mean the suite ran and rejected the commit. */
export const FAILED_CONCLUSIONS: readonly string[];
/** Conclusions that tested nothing, so they may never settle the verdict. */
export const INCONCLUSIVE_CONCLUSIONS: readonly string[];

/**
 * Fold every e2e.yml run for one commit into a single verdict. A success
 * anywhere wins; a failure is final only once nothing is still in flight.
 */
export function classifyRuns(runs: E2eWorkflowRun[] | null | undefined): E2eVerdict;

/** The subset of a GitHub pull request this gate reads. */
export interface E2ePullRequest {
  state?: string | null;
  merged?: boolean | null;
}

/**
 * Why a still-waiting gate should stop: the PR is merged or closed, so there is
 * nothing left to gate. null = keep waiting (open PR, no PR number, failed read).
 */
export function prSettledReason(pr: E2ePullRequest | null | undefined): string | null;

/**
 * Poll until E2E settles, the PR is no longer open, or the deadline. A settled
 * classifyRuns verdict (pass or fail) wins over the PR check — a merged PR must
 * not paper over a red E2E run.
 */
export function waitForE2eVerdict(opts: {
  fetchRuns: () => Promise<E2eWorkflowRun[] | null | undefined>;
  fetchPullRequest: () => Promise<E2ePullRequest | null | undefined>;
  pollSeconds: number;
  timeoutSeconds: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
  log?: (message: string) => void;
}): Promise<E2eVerdict>;

/** Repo-relative paths from the file the workflow wrote, or [] if unreadable. */
export function readChangedFiles(file: string): string[];
