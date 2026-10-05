import type { EnvGroup } from "./types.ts";

export const platform: EnvGroup = {
  title: "Set by the platform",
  note: "Railway and CI set these; set them by hand only to reproduce a deployment locally.",
  vars: [
    {
      name: "RAILWAY_ENVIRONMENT_NAME",
      doc: "Railway environment name. Read before RAILWAY_ENVIRONMENT; `production` turns on the canonical-host redirect and names the OpenRouter attribution bucket.",
    },
    { name: "RAILWAY_ENVIRONMENT", doc: "The same name under the variable older Railway versions set." },
    { name: "RAILWAY_PUBLIC_DOMAIN", doc: "Public domain Railway assigns; APP_URL falls back to it." },
    {
      name: "RAILWAY_GIT_COMMIT_SHA",
      doc: "This app's commit, reported in tool response `_meta`. Falls back to APP_COMMIT, GIT_COMMIT, then SOURCE_COMMIT.",
    },
    { name: "APP_COMMIT", doc: "App commit when RAILWAY_GIT_COMMIT_SHA is unset." },
    { name: "GIT_COMMIT", doc: "App commit when neither of the above is set." },
    { name: "SOURCE_COMMIT", doc: "Last fallback for the app commit." },
  ],
};

export const server: EnvGroup = {
  title: "Server",
  vars: [
    { name: "PORT", doc: "Port the Bun server binds.", default: "3000" },
    {
      name: "APP_URL",
      doc: "Public origin for OAuth redirect URIs and post-login redirects. Defaults to https://$RAILWAY_PUBLIC_DOMAIN, else http://localhost:$PORT. Pin it when a service has more than one domain, or OAuth builds its redirect URI on whichever domain Railway picked.",
    },
    {
      name: "CANONICAL_HOST_REDIRECT",
      doc: "301s GET and HEAD on any other host to APP_URL. Unset: on only in the Railway `production` environment. 1 forces it on, 0 forces it off. PR environments inherit production's APP_URL, so the redirect must stay off there or every PR deploy redirects to production.",
    },
    { name: "MCP_PATH", doc: "Mount path of the MCP transport.", default: "/mcp" },
    {
      name: "MCP_MAX_RESULT_CHARS",
      doc: "Character budget for one MCP tool response, so a single response cannot overflow the calling assistant's context.",
      default: "200000",
    },
    {
      name: "SSE_MAX_CLIENTS",
      doc: "Ceiling on open /api/atlas-events connections across all visitors; past it new connections get 503 and miss live update pushes. No capacity measurement backs this value yet.",
      default: "500",
    },
  ],
};
