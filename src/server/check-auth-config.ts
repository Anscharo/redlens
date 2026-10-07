import { config } from "./config.ts";

// Boot-time warning when logins were requested (USERS_ENABLED=1) but a hard
// prerequisite is missing, so the surface stays off (see config.usersEnabled)
// instead of failing per request mid-OAuth. Warns rather than exits: the
// reader and MCP serve fine without logins.
export function checkAuthConfig(): void {
  if (!config.usersRequested) return;
  const problems: string[] = [];
  if (!config.jwtSecret) problems.push("CHAT_JWT_SECRET unset — sessions can't be signed (the login surface stays disabled)");
  const github = config.githubClientId && config.githubClientSecret;
  const google = config.googleClientId && config.googleClientSecret;
  if (!github && !google) {
    problems.push("no OAuth provider configured — set GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET and/or the GOOGLE_ pair");
  } else {
    if (config.githubClientId && !config.githubClientSecret) problems.push("GITHUB_CLIENT_ID set but GITHUB_CLIENT_SECRET missing");
    if (config.githubClientSecret && !config.githubClientId) problems.push("GITHUB_CLIENT_SECRET set but GITHUB_CLIENT_ID missing");
    if (config.googleClientId && !config.googleClientSecret) problems.push("GOOGLE_CLIENT_ID set but GOOGLE_CLIENT_SECRET missing");
    if (config.googleClientSecret && !config.googleClientId) problems.push("GOOGLE_CLIENT_SECRET set but GOOGLE_CLIENT_ID missing");
  }
  if (!problems.length) return;
  console.warn(`⚠️  USERS_ENABLED is set but the login surface is OFF (usersEnabled=${config.usersEnabled}) — incomplete config:`);
  for (const p of problems) console.warn(`   • ${p}`);
  console.warn(`   redirect URI in use: ${config.appUrl}/api/auth/<provider>/callback`);
}
