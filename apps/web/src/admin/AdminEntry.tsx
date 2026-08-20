import { Route, Switch } from "wouter";
import { AdminPage } from "./AdminPage";
import { PalettePage } from "./PalettePage";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function AdminEntry() {
  useDocumentTitle("Admin: Sky Atlas by Redline");
  return (
    <Switch>
      <Route path="/admin/palette">
        <PalettePage />
      </Route>
      <Route path="/admin">
        <AdminPage />
      </Route>
      <Route>
        <div style={{ padding: 32, color: "var(--tan-3)" }} className="mono">
          admin: not found
        </div>
      </Route>
    </Switch>
  );
}
