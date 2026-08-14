import { useState } from "react";
import { SignInButtons } from "./SignInButtons";
import { Link } from "../Link";
import { ROUTES } from "../../lib/routes";

// The signed-out nav menu: two entries, "Sign in" (which opens the provider
// choice as a sub-panel, mirroring the signed-in menu's Account panel) and
// "History". History is deliberately here rather than behind the sign-in wall —
// the visit log it shows is browser-local, so it needs no account.
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
        <div className="border-t border-border" />
        <SignInButtons variant="menu" source="nav" />
      </>
    );
  }

  return (
    <>
      <button className="rlc-menu-item" onClick={() => setShowSignIn(true)}>
        <span>Sign in</span>
        <span className="text-tan-3 enlargen">→</span>
      </button>
      <div className="border-t border-border" />
      <Link className="rlc-menu-item" to={ROUTES.HISTORY} onClick={onNavigate}>
        <span>History</span>
        <span className="text-tan-3 enlargen">→</span>
      </Link>
    </>
  );
}
