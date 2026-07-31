import { useEffect, useRef, useState } from "react";
import { useAuth } from "./auth";
import { SignInButtons } from "./SignInButtons";
import { Link } from "../Link";

// NavBar profile control. Signed-out: a mono "sign in" pill → dropdown with a
// provider choice (GitHub / Google), both routing through the shared openAuth.
// Signed-in: avatar → dropdown with name, an Account sub-panel (Delete
// account), and Sign out.
// Per the FE handoff we omit the GitHub @handle (not returned by /api/auth/me).
export function ProfileButton() {
  const { user, signOut, deleteAccount } = useAuth();
  const [open, setOpen] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setShowPrefs(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!user) {
    return (
      <div ref={ref} className="relative shrink-0">
        <button className="rlc-signin" onClick={() => setOpen((v) => !v)} aria-haspopup="menu" aria-expanded={open}>
          sign in
        </button>
        {open && (
          <div className="rlc-menu" role="menu">
            <SignInButtons variant="menu" source="chat" />
          </div>
        )}
      </div>
    );
  }

  const name = user.name ?? "Signed in";

  return (
    <div ref={ref} className="relative shrink-0">
      <img
        className="rlc-avatar"
        src={user.avatarUrl}
        alt={name}
        onClick={() => setOpen((v) => !v)}
      />
      {open && (
        <div className="rlc-menu" role="menu">
          {!showPrefs ? (
            <>
              <div className="flex items-center gap-[10px] px-3 pt-3 pb-[10px]">
                <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-full border border-border" />
                <div className="min-w-0">
                  <div className="rlc-menu-name">{name}</div>
                </div>
              </div>
              <div className="border-t border-border" />
              <button className="rlc-menu-item" onClick={() => setShowPrefs(true)}>
                <span>Account</span>
                <span className="text-tan-3 enlargen">→</span>
              </button>
              <div className="border-t border-border" />
              <Link className="rlc-menu-item" to="/collections" onClick={() => setOpen(false)}>
                <span>Collections</span>
                <span className="text-tan-3 enlargen">→</span>
              </Link>
              <div className="border-t border-border" />
              <button
                className="rlc-menu-item"
                onClick={() => {
                  setOpen(false);
                  void signOut();
                }}
              >
                <span>Sign out</span>
              </button>
            </>
          ) : (
            <>
              <button
                className="rlc-menu-item mono text-[11px] text-tan-3"
                onClick={() => setShowPrefs(false)}
              >
                <span>← account</span>
              </button>
              <div className="border-t border-border" />
              <button
                className="rlc-menu-item text-[12.5px] text-red"
                onClick={() => {
                  // Confirm before an irreversible wipe of chats + Collections.
                  if (!window.confirm("Delete your account and all your chats and Collections? This can't be undone.")) return;
                  setOpen(false);
                  void deleteAccount().then((ok) => {
                    if (!ok) window.alert("Couldn't delete your account. Please try again.");
                  });
                }}
              >
                <span>Delete account</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
