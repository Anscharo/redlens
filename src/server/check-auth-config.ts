import { config } from "./config.ts";

type CredentialPair = [idName: string, id: unknown, secretName: string, secret: unknown];

// A provider with only one half of its client id / secret pair set.
function halfConfigured([idName, id, secretName, secret]: CredentialPair): string[] {
  if (id && !secret) return [`${idName} set but ${secretName} missing`];
  if (secret && !id) return [`${secretName} set but ${idName} missing`];
  return [];
}

// Boot-time warning when logins were requested (USERS_ENABLED=1) but a hard
// prerequisite is missing, so the surface stays off (see config.usersEnabled)
// instead of failing per request mid-OAuth. Warns rather than exits: the
// reader and MCP serve fine without logins.
export function checkAuthConfig(): void {
  if (!config.usersRequested) return;
  const problems: string[] = [];
  if (!config.jwtSecret) problems.push("CHAT_JWT_SECRET unset — sessions can't be signed (the login surface stays disabled)");
  const providers: CredentialPair[] = [
    ["GITHUB_CLIENT_ID", config.githubClientId, "GITHUB_CLIENT_SECRET", config.githubClientSecret],
    ["GOOGLE_CLIENT_ID", config.googleClientId, "GOOGLE_CLIENT_SECRET", config.googleClientSecret],
  ];
  if (providers.some(([, id, , secret]) => id && secret)) {
    problems.push(...providers.flatMap(halfConfigured));
  } else {
    problems.push("no OAuth provider configured — set GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET and/or the GOOGLE_ pair");
  }
  if (!problems.length) return;
  console.warn(`⚠️  USERS_ENABLED is set but the login surface is OFF (usersEnabled=${config.usersEnabled}) — incomplete config:`);
  for (const p of problems) console.warn(`   • ${p}`);
  console.warn(`   redirect URI in use: ${config.appUrl}/api/auth/<provider>/callback`);
}
