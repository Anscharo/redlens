// OpenRouter app attribution (`X-Title`), shared by every request we send it:
// chat completions, embeddings, and Jev. One name per deployment so usage
// splits cleanly in OpenRouter's dashboard:
//   "Sky Atlas Redline (production)"  — Railway environment name, as Railway spells it
//   "Sky Atlas Redline (Local)"       — no Railway env var present
//   "Sky Atlas Redline Evals"         — anything launched from scripts/eval/
const BASE = "Sky Atlas Redline";

const isEval = (): boolean =>
  process.env.OPENROUTER_APP_KIND === "eval" || /[\\/]scripts[\\/]eval[\\/]/.test(process.argv[1] ?? "");

// Railway environment name, or "" off Railway. Read at call time (not via
// config) so this stays independent of config load order. Callers that cache a
// client (chat) freeze the title at first use. `||` not `??`: an empty NAME var
// must fall through to the second. Case is kept as Railway gives it.
const railwayEnv = (): string =>
  process.env.RAILWAY_ENVIRONMENT_NAME?.trim() || process.env.RAILWAY_ENVIRONMENT?.trim() || "";

export function openrouterAppTitle(): string {
  if (isEval()) return `${BASE} Evals`;
  return `${BASE} (${railwayEnv() || "Local"})`;
}

// The same split as the title, as a PostHog `environment` property value:
// "eval", the Railway environment name, or "local". Lowercase-stable "local"
// and "eval" so an insight filter doesn't need to know the title's spelling.
export function openrouterEnvironment(): string {
  if (isEval()) return "eval";
  return railwayEnv() || "local";
}

export function openrouterAttributionHeaders(): Record<string, string> {
  return { "X-Title": openrouterAppTitle() };
}
