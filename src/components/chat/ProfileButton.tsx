import { useEffect, useRef, useState } from "react";
import { useAuth } from "./auth";
import { usePrefs, type ChatPrefs } from "./usePrefs";
import { SignInButtons } from "./SignInButtons";
import { Link } from "../Link";
import { chatEnabled } from "../../lib/chatEnabled";
import { ROUTES } from "../../lib/routes";

// NavBar profile control. Signed-out: a mono "sign in" pill → dropdown with a
// provider choice (GitHub / Google), both routing through the shared openAuth.
// Signed-in: avatar → dropdown with name, a Preferences sub-panel (tool-traces
// + reduce-motion switches, persisted to localStorage), and Sign out.
// Per the FE handoff we omit the GitHub @handle (not returned by /api/auth/me).
export function ProfileButton() {
  const { user, signOut, deleteAccount } = useAuth();
  const { prefs, setPref } = usePrefs();
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
                <span>Preferences</span>
                <span className="text-tan-3">→</span>
              </button>
              <div className="border-t border-border" />
              <Link className="rlc-menu-item" to="/collections" onClick={() => setOpen(false)}>
                <span>Collections</span>
                <span className="text-tan-3">→</span>
              </Link>
              {chatEnabled() && (
                <>
                  <div className="border-t border-border" />
                  <Link className="rlc-menu-item" to={ROUTES.CONVERSATIONS} onClick={() => setOpen(false)}>
                    <span>Conversations</span>
                    <span className="text-tan-3">→</span>
                  </Link>
                </>
              )}
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
                <span>← preferences</span>
              </button>
              <div className="border-t border-border" />
              <PrefSwitch label="Show tool-call traces" prefKey="traces" prefs={prefs} setPref={setPref} />
              <PrefSwitch label="Reduce motion" prefKey="reduceMotion" prefs={prefs} setPref={setPref} />
              <div className="px-3 pt-2 pb-[11px]">
                <div className="mono text-[9.5px] text-gray leading-normal">
                  surfaced from local storage · syncs per-browser
                </div>
              </div>
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

function PrefSwitch({
  label,
  prefKey,
  prefs,
  setPref,
}: {
  label: string;
  prefKey: keyof ChatPrefs;
  prefs: ChatPrefs;
  setPref: <K extends keyof ChatPrefs>(k: K, v: ChatPrefs[K]) => void;
}) {
  const on = prefs[prefKey];
  return (
    <button className="rlc-menu-item" onClick={() => setPref(prefKey, !on)} role="switch" aria-checked={on}>
      <span className="text-[12.5px]">{label}</span>
      <span className="rlc-switch" data-on={on}>
        <span className="rlc-switch-knob" />
      </span>
    </button>
  );
}
