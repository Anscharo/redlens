// Configured chat model IDs, checked once at boot against OpenRouter's model
// list. OpenRouter rejects the whole request with a 400 ("<id> is not a valid
// model ID") when any entry of the `models` chain is unknown, so one mistyped
// ID in a tier's env var fails every turn routed to that tier. An ID the
// catalog does not list is logged, captured, and left out of the chains
// resolveTierModels hands out, so the turn runs on the rest of the chain or on
// the default one. Until the check completes, or when the catalog cannot be
// read, every configured ID is used as is.
import { config } from "../config.ts";
import { openrouterAttributionHeaders } from "../openrouter-attribution.ts";
import { captureError } from "../posthog-node.ts";

const unknownIds = new Set<string>();

/** The chain with every ID the boot check found missing from the catalog removed. */
export function knownChain(models: string[]): string[] {
  return unknownIds.size ? models.filter((m) => !unknownIds.has(m)) : models;
}

export function configuredChatModels(): string[] {
  const all = [
    config.chatModel, ...config.chatModelFallbacks, ...config.chatModelFast,
    ...config.chatModelStrong, config.chatSummaryModel,
  ];
  return [...new Set(all.filter(Boolean))];
}

// Variant suffixes (`:free`, `:nitro`, `:online`) are not all listed, so an ID
// counts as known when its base is. OpenRouter's own routers (`openrouter/*`)
// are never flagged.
export function isListed(id: string, catalog: Set<string>): boolean {
  return catalog.has(id) || catalog.has(id.split(":")[0]) || id.startsWith("openrouter/");
}

export type FetchCatalog = () => Promise<Set<string>>;

async function fetchCatalog(): Promise<Set<string>> {
  const res = await fetch(`${config.openrouterBaseUrl}/models`, {
    headers: openrouterAttributionHeaders(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`model catalog: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: Array<{ id?: unknown }> };
  return new Set((body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === "string"));
}

/** Returns the configured IDs the catalog does not list. An empty catalog proves nothing, so it flags none. */
export async function checkChatModelIds(fetchIt: FetchCatalog = fetchCatalog): Promise<string[]> {
  let catalog: Set<string>;
  try {
    catalog = await fetchIt();
  } catch (err) {
    console.warn(`⚠️  chat model check skipped: ${(err as Error).message}`);
    return [];
  }
  if (catalog.size === 0) return [];
  const missing = configuredChatModels().filter((id) => !isListed(id, catalog));
  for (const id of missing) {
    unknownIds.add(id);
    console.error(`❌ chat model ${JSON.stringify(id)} is not in OpenRouter's model list — left out of every tier chain; fix the env var that names it`);
    captureError(new Error(`configured chat model not in OpenRouter catalog: ${id}`), {}, { stage: "boot_model_check", model: id });
  }
  return missing;
}

/** Test seam: forget what a previous check found. */
export function resetModelCatalog(): void {
  unknownIds.clear();
}
