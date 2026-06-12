import { Link } from "./Link";
import { NAV_PAGE_ROUTES, type NavPage } from "../lib/routes";
import { ProfileButton } from "./chat/ProfileButton";

export interface NavBarProps {
  activePage: NavPage | null;
}

export function NavBar({ activePage }: NavBarProps) {
  /* Nav links — row 1 right on mobile, row 1 right on desktop */
  return (
    <div className="order-2 sm:order-3 flex-1 flex items-center justify-end gap-2">
      <NavLink page="atlas" active={activePage === "atlas"}>
        Reader
      </NavLink>
      <NavLink page="radar" active={activePage === "radar"}>
        Radar
      </NavLink>
      <NavLink page="reports" active={activePage === "reports"}>
        Reports
      </NavLink>
      {__CHAT_ENABLED__ && <ProfileButton />}
    </div>
  );
}

function NavLink({
  children,
  page,
  active,
}: {
  children: React.ReactNode;
  page: NavPage;
  active: boolean;
}) {
  return (
    <Link
      to={NAV_PAGE_ROUTES[page]}
      className="nav-link shrink-0 px-3 py-1.5 rounded text-sm"
      data-active={active ? "true" : undefined}
    >
      {children}
    </Link>
  );
}
