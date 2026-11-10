// GET /api/auth/me: the signed-in user's profile, or 401. The route itself is
// dispatched from handleAuth in auth.ts.
import { sql } from "./db.ts";
import { config } from "./config.ts";
import { getSessionUser, clearSessionCookie } from "./session.ts";
import { json } from "./http.ts";

interface MeRow {
  id: string;
  provider: string;
  name: string | null;
  avatar_url: string | null;
  email: string | null;
  github_login: string | null;
}

// A team member is a github account whose login is on INTERNAL_GITHUB_LOGINS.
// Only the boolean leaves the server, never the login or the list.
export function isInternalUser(u: { provider: string; github_login: string | null }): boolean {
  if (u.provider !== "github" || !u.github_login) return false;
  return config.internalGithubLogins.includes(u.github_login.toLowerCase());
}

export async function handleMe(req: Request): Promise<Response> {
  const session = await getSessionUser(req);
  if (!session) return json({ error: "unauthenticated" }, 401);
  const rows = (await sql`
    SELECT id, provider, name, avatar_url, email, github_login FROM users WHERE id = ${session.user.id}
  `) as MeRow[];
  if (!rows[0]) return json({ error: "unauthenticated" }, 401, [clearSessionCookie()]);
  const u = rows[0];
  const body = { id: u.id, name: u.name, avatarUrl: u.avatar_url, provider: u.provider, email: u.email };
  return json(isInternalUser(u) ? { ...body, internal: true } : body, 200, session.refresh ? [session.refresh] : []);
}
