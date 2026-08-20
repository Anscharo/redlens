import { Link } from "../Link";

// One row of the nav dropdown, shared by the signed-in (ProfileButton) and
// signed-out (SignedOutMenu) menus. Both now list some of the same destinations,
// and the markup had already drifted between copies — this is the one place the
// row's shape lives.

export const MenuRule = () => <div className="border-t border-border" />;

const Arrow = () => <span className="text-tan-3 enlargen">→</span>;

/** A row that navigates somewhere. */
export function MenuLink({ to, label, onNavigate }: { to: string; label: string; onNavigate: () => void }) {
  return (
    <Link className="rlc-menu-item" to={to} onClick={onNavigate}>
      <span>{label}</span>
      <Arrow />
    </Link>
  );
}

/** A row that opens a sub-panel of the same menu. */
export function MenuButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="rlc-menu-item" onClick={onClick}>
      <span>{label}</span>
      <Arrow />
    </button>
  );
}
