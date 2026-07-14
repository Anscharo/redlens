import { GitHubMark, GoogleMark } from "./glyphs";
import { useAuth, type AuthProvider } from "./auth";
import { track } from "../../lib/analytics";

// Shared GitHub/Google sign-in buttons. Two visual variants back the two call
// sites that previously duplicated this markup: ProfileButton's signed-out
// dropdown ("menu") and ChatPanel's inline composer prompt ("composer").
export function SignInButtons({
  variant = "menu",
  source = "chat",
}: {
  variant?: "menu" | "composer";
  source?: string;
}) {
  const { openAuth } = useAuth();

  const click = (provider: AuthProvider) => {
    track("chat_signin_click", { product: source, provider });
    openAuth(provider);
  };

  if (variant === "composer") {
    return (
      <div className="rlc-composer flex flex-col gap-[7px]">
        <button className="rlc-signin w-full justify-center p-[11px]" onClick={() => click("github")}>
          <GitHubMark /> sign in with github to ask
        </button>
        <button className="rlc-signin w-full justify-center p-[11px]" onClick={() => click("google")}>
          <GoogleMark /> sign in with google to ask
        </button>
      </div>
    );
  }

  return (
    <>
      <button className="rlc-menu-item rlc-signin-menu justify-start" onClick={() => click("github")}>
        <GitHubMark /> <span>Continue with GitHub</span>
      </button>
      <div className="border-t border-border" />
      <button className="rlc-menu-item rlc-signin-menu justify-start" onClick={() => click("google")}>
        <GoogleMark /> <span>Continue with Google</span>
      </button>
    </>
  );
}
