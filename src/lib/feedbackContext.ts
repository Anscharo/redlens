// Pure feedback-context builder (buildFeedbackContext) + a thin hook wrapper
// (useFeedbackContext) that supplies the browser-global inputs. Split so the
// context-shaping logic — url/host derivation, console fit+redact, the
// `context` allowlist shape the server expects — is testable in the node
// vitest environment with zero DOM (see feedbackContext.test.ts).
//
// atlasCommit is NEVER derived from window.__ATLAS_SHA__ directly: the hook
// goes through liveAtlasSha() (src/lib/atlasBase.ts), which guards against
// the unsubstituted "{{ATLAS_SHA}}" placeholder (a stale cached shell) ever
// reaching a real request. buildFeedbackContext just takes the already-
// guarded value as an input.
import { usePageContext } from "../components/chat/pageContext";
import { useDataSource, type DataSource } from "./dataSource";
import { liveAtlasSha } from "./atlasBase";
import { consoleSnapshot, fitConsole, MAX_SNAPSHOT_CHARS, type LogEntry } from "./consoleBuffer";
import { redact } from "./redact";
import { sessionId } from "./analytics";

const MAX_URL_LEN = 500;

export interface FeedbackConsoleEntry {
  level: string;
  text: string;
}

// Mirrors the server's context allowlist (src/server/feedback-validate.ts
// CONTEXT_KEYS) plus the top-level fields POST /api/feedback accepts. Message,
// the honeypot, and elapsedMs are owned by FeedbackModal, not here — those
// aren't "context", they're the submission itself.
export interface FeedbackContext {
  url: string;
  host: string;
  appCommit: string;
  atlasCommit?: string;
  atlasBase: string;
  previewId?: string;
  nodeId?: string;
  sessionId?: string;
  context: {
    viewport: string;
    theme?: string;
    route: string;
    referrer: string;
    language: string;
    // What the user clicked/focused before opening the modal, oldest first.
    // Frozen at open by the caller — see useFeedbackContext below.
    interactions: string[];
  };
  console: FeedbackConsoleEntry[];
}

export interface FeedbackContextInputs {
  pathname: string;
  search: string;
  hostname: string;
  nodeId?: string;
  appCommit: string;
  liveAtlasSha: string | null; // pre-resolved via atlasBase.ts's SHA guard
  dataSource: DataSource;
  viewportWidth: number;
  viewportHeight: number;
  dpr: number;
  language: string;
  referrer: string;
  theme?: string;
  sessionId: string | null;
  consoleEntries: LogEntry[]; // raw snapshot — this function does the fit+redact
  interactions: string[]; // already described + redacted by lastInteraction.ts
}

/** Pure: shapes a feedback submission's context fields from injected inputs.
 *  Reads no globals — see useFeedbackContext() below for the browser side. */
export function buildFeedbackContext(inputs: FeedbackContextInputs): FeedbackContext {
  // Preview mode ships its own pinned sha (a bug on a sha-pinned preview base
  // is a different bug from one on live) — it wins over the live sha.
  const atlasCommit = inputs.dataSource.preview?.sha ?? inputs.liveAtlasSha ?? undefined;
  const url = (inputs.pathname + inputs.search).slice(0, MAX_URL_LEN);
  const fitted = fitConsole(inputs.consoleEntries, MAX_SNAPSHOT_CHARS);

  return {
    url,
    host: inputs.hostname,
    appCommit: inputs.appCommit,
    atlasCommit,
    atlasBase: inputs.dataSource.base,
    previewId: inputs.dataSource.preview?.id,
    nodeId: inputs.nodeId,
    sessionId: inputs.sessionId ?? undefined,
    context: {
      viewport: `${inputs.viewportWidth}x${inputs.viewportHeight}@${inputs.dpr}`,
      theme: inputs.theme,
      route: inputs.pathname,
      referrer: inputs.referrer,
      language: inputs.language,
      interactions: inputs.interactions,
    },
    console: fitted.map((e) => ({ level: e.level, text: redact(e.text) })),
  };
}

/** Browser-facing wrapper: reads page/route/data-source context once per
 *  render and returns a BUILDER function, not a snapshot — callers must
 *  invoke it at submit time, not at modal-open time, so the console excerpt
 *  covers everything up to the send. Deliberately collects no cookies,
 *  localStorage, search query text, or user agent (the server reads UA from
 *  the request header).
 *
 *  The interaction trail is the deliberate exception, and is passed IN rather
 *  than read here: it has to be frozen when the modal opens, or the user's
 *  clicks inside the form would overwrite the very thing it records. */
export function useFeedbackContext(): (interactions: string[]) => FeedbackContext {
  const pageContext = usePageContext();
  const dataSource = useDataSource();

  return (interactions: string[]) =>
    buildFeedbackContext({
      pathname: window.location.pathname,
      search: window.location.search,
      hostname: window.location.hostname,
      nodeId: pageContext.nodeId,
      appCommit: __COMMIT_HASH__,
      liveAtlasSha: liveAtlasSha(),
      dataSource,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      dpr: window.devicePixelRatio,
      language: navigator.language,
      referrer: document.referrer,
      theme: document.documentElement.getAttribute("data-theme") ?? undefined,
      sessionId: sessionId(),
      consoleEntries: consoleSnapshot(),
      interactions,
    });
}
