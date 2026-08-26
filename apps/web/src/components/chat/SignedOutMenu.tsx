import { useState } from "react";
import { SignInButtons } from "./SignInButtons";
import { MenuButton, MenuLink, MenuRule } from "./MenuRow";
import { ThemePicker } from "./ThemePicker";
import { ROUTES } from "@/lib/routes";

// The signed-out nav menu: "Sign in" (which opens the provider choice as a
// sub-panel, mirroring the signed-in menu's Account panel), "History", and
// the theme picker. History and theme are both deliberately here rather than
// behind the sign-in wall — the visit log is browser-local and theme is
// per-browser, not account data, so neither needs an account.
export function SignedOutMenu({ onNavigate }: { onNavigate: () => void }) {
  const [showSignIn, setShowSignIn] = useState(false);

  if (showSignIn) {
    return (
      <>
        <button
          className="rlc-menu-item mono text-[11px] text-tan-3"
          onClick={() => setShowSignIn(false)}
        >
          <span>← sign in</span>
        </button>
        <MenuRule />
        <SignInButtons variant="menu" source="nav" />
      </>
    );
  }

  return (
    <>
      <MenuButton label="Sign in" onClick={() => setShowSignIn(true)} />
      <MenuRule />
      <MenuLink to={ROUTES.HISTORY} label="History" onNavigate={onNavigate} />
      <MenuRule />
      <ThemePicker />
    </>
  );
}
