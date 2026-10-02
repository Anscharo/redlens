import type { EnvGroup } from "./types.ts";

export const chatLimits: EnvGroup = {
  title: "Chat: limits",
  note: "Real spend is capped by the account-wide commons pool (OPENROUTER_MANAGEMENT_KEY). These limits keep one user from monopolising the shared service.",
  vars: [
    {
      name: "RATE_LIMIT_TOKENS_PER_WINDOW",
      doc: "Input plus output tokens one user may spend per window before /api/chat answers 429. The default is effectively unlimited; 750000 restores a real per-user limit.",
      default: "1000000000000",
      key: "rateLimitTokensPerWindow",
    },
    { name: "RATE_LIMIT_WINDOW_MINUTES", doc: "Length of the trailing token window.", default: "90", key: "rateLimitWindowMinutes" },
    {
      name: "RATE_LIMIT_BOOST_LOGINS",
      doc: "CSV of GitHub logins, case-insensitive, that get the boosted limit. Only the github provider matches.",
      default: "",
      key: "rateLimitBoostLogins",
    },
    {
      name: "RATE_LIMIT_TOKENS_PER_WINDOW_BOOSTED",
      doc: "The boosted limit, an explicit token count so a person's limit can be read straight off the environment.",
      default: "3000000",
      key: "rateLimitTokensPerWindowBoosted",
    },
    {
      name: "CHAT_MAX_CONCURRENT_PER_USER",
      doc: "Turns one user may have in flight. In memory, which is correct because the service runs as one replica.",
      default: "3",
      key: "chatMaxConcurrentPerUser",
    },
  ],
};

export const feedback: EnvGroup = {
  title: "Feedback (the \"?\" button → /api/feedback)",
  note: "On by default and needs only a database. Every stored report emits a server-side feedback_received event, and a daily PostHog alert on it is the only notice a report arrived; it rides POSTHOG_KEY. Rate limits key on the user id when signed in, else the rl_fb cookie, never on IP: Railway's load balancer collapses every client into one address.",
  vars: [
    { name: "FEEDBACK_ENABLED", doc: "0 makes the endpoint 404.", default: "1", key: "feedbackEnabled" },
    { name: "FEEDBACK_MAX_BYTES", doc: "Cap on the request body, checked against actual bytes.", default: "32768", key: "feedbackMaxBytes" },
    { name: "FEEDBACK_ANON_PER_HOUR", doc: "Anonymous reports per hour.", default: "3", key: "feedbackAnonPerHour" },
    { name: "FEEDBACK_ANON_PER_DAY", doc: "Anonymous reports per day.", default: "10", key: "feedbackAnonPerDay" },
    { name: "FEEDBACK_USER_PER_HOUR", doc: "Signed-in reports per hour.", default: "15", key: "feedbackUserPerHour" },
    { name: "FEEDBACK_USER_PER_DAY", doc: "Signed-in reports per day.", default: "50", key: "feedbackUserPerDay" },
    { name: "FEEDBACK_GLOBAL_PER_DAY", doc: "Circuit breaker across all submitters: everyone gets 429 past it.", default: "500", key: "feedbackGlobalPerDay" },
    {
      name: "FEEDBACK_SURVEY_ID",
      doc: "Mirrors each accepted report into this PostHog survey (the uuid in its URL), after validation and rate limiting. Needs POSTHOG_KEY. Empty: no mirror; Postgres is the record either way.",
      default: "",
      key: "feedbackSurveyId",
    },
    {
      name: "FEEDBACK_SURVEY_QUESTION_ID",
      doc: "Question uuid within that survey, needed once it has several questions. Empty uses the single-question $survey_response property. Read it back with the public key:\n  curl -s \"https://us.i.posthog.com/api/surveys/?token=$VITE_POSTHOG_KEY\" \\\n    | jq '.surveys[] | select(.id==\"<survey-uuid>\") | .questions[] | {id, question}'",
      default: "",
      key: "feedbackSurveyQuestion",
    },
  ],
};

export const dev: EnvGroup = {
  title: "Local dev (pnpm dev)",
  note: "Each skips one preflight step; see the root CLAUDE.md, Local dev.",
  vars: [
    { name: "DEV_NO_INSTALL", doc: "1 skips the pnpm install check." },
    { name: "DEV_NO_DB", doc: "1 skips Docker and Postgres; the reader works from disk artifacts, and history, chat and previews need a database." },
    { name: "DEV_NO_WORKER", doc: "1 brings the database up but skips the atlas sync; the server migrates at boot." },
    { name: "DEV_NO_BUILD", doc: "1 skips the artifact build and the settlement refresh." },
    { name: "DEV_NO_SETTLEMENTS", doc: "1 skips only the settlement refresh." },
  ],
};
