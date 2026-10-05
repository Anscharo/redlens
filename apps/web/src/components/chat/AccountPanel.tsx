import { useAuth } from "./auth";
import { usePrefs } from "./usePrefs";
import { MenuRule } from "./MenuRow";
import { PrefSwitch } from "./PrefSwitch";

// Confirm before an irreversible wipe. The prompt names everything the delete
// actually takes (PRIVACY.md §6 is the same list) — preview history cascades
// with the account too.
function confirmAndDelete(deleteAccount: () => Promise<boolean>, onClose: () => void) {
  if (!window.confirm("Delete your account and all your chats, Collections, and preview history? This can't be undone.")) return;
  onClose();
  void deleteAccount().then((ok) => {
    if (!ok) window.alert("Couldn't delete your account. Please try again.");
  });
}

// The Account sub-panel: back link, the reduce-motion switch (persisted to
// localStorage), and Delete account.
export function AccountPanel({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const { deleteAccount } = useAuth();
  const { prefs, setPref } = usePrefs();
  return (
    <>
      <button className="rlc-menu-item mono text-[11px] text-tan-3" onClick={onBack}>
        <span>← account</span>
      </button>
      <MenuRule />
      <PrefSwitch label="Reduce motion" on={prefs.reduceMotion} onChange={() => setPref("reduceMotion", !prefs.reduceMotion)} />
      <div className="px-3 pt-2 pb-[11px]">
        <div className="mono text-[9.5px] text-gray leading-normal">surfaced from local storage · syncs per-browser</div>
      </div>
      <MenuRule />
      <button className="rlc-menu-item text-[12.5px] text-red" onClick={() => confirmAndDelete(deleteAccount, onClose)}>
        <span>Delete account</span>
      </button>
    </>
  );
}
