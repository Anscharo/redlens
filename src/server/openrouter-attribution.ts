// OpenRouter app attribution (`X-Title`), shared by every request we send it:
// chat completions, embeddings, and Jev. One name per deployment so usage
// splits cleanly in OpenRouter's dashboard:
//   "Sky Atlas Redline (production)"  — Railway environment name, as Railway spells it
//   "Sky Atlas Redline (Local)"       — no Railway env var present
//   "Sky Atlas Redline Evals"         — anything launched from scripts/eval/
const BASE = "Sky Atlas Redline";

const isEval = (): boolean =>
  process.env.OPENROUTER_APP_KIND === "eval" || /[\\/]scripts[\\/]eval[\\/]/.test(process.argv[1] ?? "");

export function openrouterAppTitle(): string {
  if (isEval()) return `${BASE} Evals`;
  // Read live (not via config) so the name is never stale and the eval check
  // above stays independent of config load order. Case is kept as Railway gives it.
  const env = (process.env.RAILWAY_ENVIRONMENT_NAME ?? process.env.RAILWAY_ENVIRONMENT ?? "").trim();
  return `${BASE} (${env || "Local"})`;
}

export function openrouterAttributionHeaders(): Record<string, string> {
  return { "X-Title": openrouterAppTitle() };
}
