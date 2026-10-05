import { Fragment } from "react";
import { GitHubMark, GoogleMark } from "./glyphs";
import { useAuth, type AuthProvider } from "./auth";
import { authProviders } from "../../lib/authProviders";
import { track } from "../../lib/analytics";

// Each provider's mark and its copy in both variants, in display order.
const PROVIDERS: { id: AuthProvider; Mark: typeof GitHubMark; composer: string; menu: string }[] = [
  { id: "github", Mark: GitHubMark, composer: "sign in with github to ask", menu: "Continue with GitHub" },
  { id: "google", Mark: GoogleMark, composer: "sign in with google to ask", menu: "Continue with Google" },
];

export interface SignInButtonsProps {
  variant?: "menu" | "composer";
  source?: string;
  // Menu variant only: use the app's sans-serif (Inter) instead of the chat
  // menu's serif. On in the save-collection modal (an app-styled surface); off
  // in the profile dropdown, which stays serif like the rest of that menu.
  sansSerif?: boolean;
  // Runs just before the full-page OAuth redirect — a hook for a caller to stash
  // any per-tab state it wants restored on return (e.g. reopen the save modal).
  onBeforeSignIn?: () => void;
}

// Shared GitHub/Google sign-in buttons, in two visual variants: ProfileButton's
// signed-out dropdown ("menu") and ChatPanel's inline composer prompt
// ("composer"). Only the providers this environment configured render (see
// src/lib/authProviders.ts) — a single provider's credentials render a single
// button. Menu rows are separated by a rule.
export function SignInButtons({ variant = "menu", source = "chat", sansSerif = false, onBeforeSignIn }: SignInButtonsProps) {
  const { openAuth } = useAuth();
  const configured = authProviders();
  const providers = PROVIDERS.filter((p) => configured.includes(p.id));
  const click = (provider: AuthProvider) => {
    track("chat_signin_click", { product: source, provider });
    onBeforeSignIn?.();
    openAuth(provider);
  };
  if (variant === "composer") {
    return (
      <div className="rlc-composer flex flex-col gap-[7px]">
        {providers.map(({ id, Mark, composer }) => (
          <button key={id} className="rlc-signin w-full justify-center p-[11px]" onClick={() => click(id)}>
            <Mark />
            {` ${composer}`}
          </button>
        ))}
      </div>
    );
  }
  return providers.map(({ id, Mark, menu }, i) => (
    <Fragment key={id}>
      {i > 0 && <div className="border-t border-border" />}
      <button className={`rlc-menu-item justify-start${sansSerif ? " rlc-signin-menu" : ""}`} onClick={() => click(id)}>
        <Mark /> <span>{menu}</span>
      </button>
    </Fragment>
  ));
}
