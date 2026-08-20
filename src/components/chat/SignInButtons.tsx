import { GitHubMark, GoogleMark } from "./glyphs";
import { useAuth, type AuthProvider } from "./auth";
import { authProviders } from "@/lib/authProviders";
import { track } from "@/lib/analytics";

// Shared GitHub/Google sign-in buttons. Two visual variants back the two call
// sites that previously duplicated this markup: ProfileButton's signed-out
// dropdown ("menu") and ChatPanel's inline composer prompt ("composer").
export function SignInButtons({
  variant = "menu",
  source = "chat",
  sansSerif = false,
  onBeforeSignIn,
}: {
  variant?: "menu" | "composer";
  source?: string;
  // Menu variant only: use the app's sans-serif (Inter) instead of the chat
  // menu's serif. On in the save-collection modal (an app-styled surface); off
  // in the profile dropdown, which stays serif like the rest of that menu.
  sansSerif?: boolean;
  // Runs just before the full-page OAuth redirect — a hook for a caller to stash
  // any per-tab state it wants restored on return (e.g. reopen the save modal).
  onBeforeSignIn?: () => void;
}) {
  const { openAuth } = useAuth();
  // Only the providers this environment configured (see src/lib/authProviders.ts).
  // An environment with a single provider's credentials renders a single button.
  const providers = authProviders();

  const click = (provider: AuthProvider) => {
    track("chat_signin_click", { product: source, provider });
    onBeforeSignIn?.();
    openAuth(provider);
  };

  if (variant === "composer") {
    return (
      <div className="rlc-composer flex flex-col gap-[7px]">
        {providers.includes("github") && (
          <button className="rlc-signin w-full justify-center p-[11px]" onClick={() => click("github")}>
            <GitHubMark /> sign in with github to ask
          </button>
        )}
        {providers.includes("google") && (
          <button className="rlc-signin w-full justify-center p-[11px]" onClick={() => click("google")}>
            <GoogleMark /> sign in with google to ask
          </button>
        )}
      </div>
    );
  }

  const github = providers.includes("github") && (
    <button className={`rlc-menu-item justify-start${sansSerif ? " rlc-signin-menu" : ""}`} onClick={() => click("github")}>
      <GitHubMark /> <span>Continue with GitHub</span>
    </button>
  );
  const google = providers.includes("google") && (
    <button className={`rlc-menu-item justify-start${sansSerif ? " rlc-signin-menu" : ""}`} onClick={() => click("google")}>
      <GoogleMark /> <span>Continue with Google</span>
    </button>
  );

  return (
    <>
      {github}
      {github && google && <div className="border-t border-border" />}
      {google}
    </>
  );
}
