import { useCallback, useRef, useState } from "react";
import { useAuth } from "./auth";
import { SignedOutMenu } from "./SignedOutMenu";
import { MenuGlyph } from "./glyphs";
import { AccountMenu } from "./AccountMenu";
import { AccountPanel } from "./AccountPanel";
import { useOutsidePress } from "./useLightDismiss";

// Open/closed plus which panel of the signed-in menu shows. A press outside
// closes the menu AND returns it to its main list; a navigation or sign-out
// only closes it.
function useProfileMenu() {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const dismiss = useCallback(() => {
    setOpen(false);
    setShowPrefs(false);
  }, []);
  useOutsidePress(ref, open, dismiss);
  return { ref, open, toggle: () => setOpen((v) => !v), close, showPrefs, setShowPrefs };
}

// NavBar profile control. Signed-out: a menu pill → dropdown with Sign in
// (a sub-panel offering GitHub / Google, both routing through the shared
// openAuth) and History — see SignedOutMenu. Signed-in: avatar → dropdown with
// name, an Account sub-panel (reduce-motion switch, persisted to localStorage,
// plus Delete account), History, Collections, and Sign out — see
// AccountMenu / AccountPanel. Theme lives on ThemeButton in the nav, not in this menu.
// Per the FE handoff we omit the GitHub @handle (not returned by /api/auth/me).
export function ProfileButton() {
  const { user } = useAuth();
  const menu = useProfileMenu();
  return (
    <div ref={menu.ref} className="relative shrink-0">
      {user ? (
        <img className="rlc-avatar" src={user.avatarUrl} alt={user.name ?? "Signed in"} onClick={menu.toggle} />
      ) : (
        <button className="rlc-signin" onClick={menu.toggle} aria-haspopup="menu" aria-expanded={menu.open} aria-label="Menu" title="Menu">
          <MenuGlyph />
        </button>
      )}
      {menu.open && (
        <div className="rlc-menu" role="menu">
          {!user ? (
            <SignedOutMenu onNavigate={menu.close} />
          ) : menu.showPrefs ? (
            <AccountPanel onBack={() => menu.setShowPrefs(false)} onClose={menu.close} />
          ) : (
            <AccountMenu user={user} onAccount={() => menu.setShowPrefs(true)} onClose={menu.close} />
          )}
        </div>
      )}
    </div>
  );
}
