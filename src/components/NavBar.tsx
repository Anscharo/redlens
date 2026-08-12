import { Link } from "./Link";
import { NAV_PAGE_ROUTES, type NavPage } from "../lib/routes";
import { ProfileButton } from "./chat/ProfileButton";
import { useDataSource } from "../lib/dataSource";
import { usersEnabled } from "../lib/usersEnabled";
import { FeedbackButton } from "./feedback/FeedbackButton";

export interface NavBarProps {
  activePage: NavPage | null;
}

export function NavBar({ activePage }: NavBarProps) {
  // Reports + chat are disabled in preview mode (they'd read main data / need a
  // logged-in session); reader + radar stay. Feedback is NOT gated on preview —
  // a broken preview build is exactly when someone wants to report it.
  const { preview } = useDataSource();
  return (
    <div className="order-2 sm:order-3 flex-1 flex items-center justify-end gap-2">
      <FeedbackButton />
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
      {usersEnabled() && !preview && <ProfileButton />}
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
