import { SignInButtons } from "./chat/SignInButtons";
import { usersEnabled } from "../lib/usersEnabled";
import type { SearchState } from "../hooks/useSearch";

/** True when the shared meaning-search budget refused this search and signing in would get the reader their own. */
export function showsLoginPrompt(state: SearchState): boolean {
  return state.status === "done" && state.semantic === "skipped" && state.semanticLimit === "shared" && usersEnabled();
}

/**
 * Shown in place of meaning results when the shared, signed-out budget is
 * spent. A signed-in reader searches on an hourly allowance of their own
 * (src/server/search-semantic-limit.ts), so signing in is the way past it.
 */
export function SemanticLoginPrompt({ state }: { state: SearchState }) {
  if (!showsLoginPrompt(state)) return null;
  return (
    <section className="flex flex-col items-center gap-4 px-4 py-16 text-center" aria-labelledby="semantic-login-heading">
      <h2 id="semantic-login-heading" className="text-lg text-tan">
        Log in for more meaning search
      </h2>
      <div className="flex w-64 flex-col">
        <SignInButtons variant="menu" source="semantic-search" sansSerif />
      </div>
    </section>
  );
}
