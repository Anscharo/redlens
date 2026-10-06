import { useAuth } from "./auth";
import { MenuButton, MenuLink, MenuRule } from "./MenuRow";
import { chatEnabled } from "../../lib/chatEnabled";
import { ROUTES } from "@/lib/routes";
import type { AuthUser } from "./api";

function AccountHeader({ user }: { user: AuthUser }) {
  return (
    <div className="flex items-center gap-[10px] px-3 pt-3 pb-[10px]">
      <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-full border border-border" />
      <div className="min-w-0">
        <div className="rlc-menu-name">{user.name ?? "Signed in"}</div>
      </div>
    </div>
  );
}

export interface AccountMenuProps {
  /** The signed-in user the menu belongs to. */
  user: AuthUser;
  /** Opens the Account sub-panel. */
  onAccount: () => void;
  /** Closes the whole menu (after a navigation or sign-out). */
  onClose: () => void;
}

// The signed-in dropdown's main list: who you are, the Account sub-panel,
// History, Collections, Conversations (only where chat is on), Sign out.
export function AccountMenu({ user, onAccount, onClose }: AccountMenuProps) {
  const { signOut } = useAuth();
  return (
    <>
      <AccountHeader user={user} />
      <MenuRule />
      <MenuButton label="Account" onClick={onAccount} />
      <MenuRule />
      <MenuLink to={ROUTES.HISTORY} label="History" onNavigate={onClose} />
      <MenuRule />
      <MenuLink to={ROUTES.COLLECTIONS} label="Collections" onNavigate={onClose} />
      {chatEnabled() && (
        <>
          <MenuRule />
          <MenuLink to={ROUTES.CONVERSATIONS} label="Conversations" onNavigate={onClose} />
        </>
      )}
      <MenuRule />
      <button
        className="rlc-menu-item"
        onClick={() => {
          onClose();
          void signOut();
        }}
      >
        <span>Sign out</span>
      </button>
    </>
  );
}
