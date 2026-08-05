import { useLocation } from "wouter";
import { Link } from "./Link";
import { NAV_PAGE_ROUTES, ROUTES, type NavPage } from "../lib/routes";
import { ProfileButton } from "./chat/ProfileButton";
import { useDataSource } from "../lib/dataSource";
import { usersEnabled } from "../lib/usersEnabled";

export interface NavBarProps {
  activePage: NavPage | null;
}

export function NavBar({ activePage }: NavBarProps) {
  // Reports + chat are disabled in preview mode (they'd read main data / need a
  // logged-in session); reader + radar stay.
  const { preview } = useDataSource();
  return (
    <div className="order-2 sm:order-3 flex-1 flex items-center justify-end gap-2">
      <NavLink page="atlas" active={activePage === "atlas"}>
        Reader
      </NavLink>
      <NavLink page="radar" active={activePage === "radar"}>
        Radar
      </NavLink>
      {!preview && (
        <NavLink page="reports" active={activePage === "reports"}>
          Reports
        </NavLink>
      )}
      <HelpLink />
      {usersEnabled() && !preview && <ProfileButton />}
    </div>
  );
}

function HelpLink() {
  const [location] = useLocation();
  const active = location === ROUTES.FEATURES;
  return (
    <Link
      to={ROUTES.FEATURES}
      className="nav-link shrink-0 flex items-center justify-center w-8 h-8 rounded"
      data-active={active ? "true" : undefined}
      title="Help & features"
      aria-label="Help &amp; features"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M9.4 9.2a2.6 2.6 0 0 1 5 .9c0 1.7-2.4 2.2-2.4 3.4" />
        <path d="M12 17h.01" />
      </svg>
    </Link>
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
