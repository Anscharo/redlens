// Every environment variable the server, the atlas worker, the build scripts and
// `pnpm dev` read, in the order `.env.example` lists them. Declare a new variable
// in its group file (or a new group, appended here); env.test.ts fails while
// code reads a variable no group declares.
import { atlasSync, worker } from "./atlas.ts";
import { chatModels } from "./chat.ts";
import { chatFacts } from "./chat-facts.ts";
import { chatVerify } from "./chat-verify.ts";
import { analytics, auth, onchain } from "./integrations.ts";
import { chatLimits, dev, feedback } from "./limits.ts";
import { previews } from "./previews.ts";
import { openrouter } from "./search.ts";
import { platform, server } from "./server.ts";
import type { EnvGroup } from "./types.ts";

export const ENV_GROUPS: EnvGroup[] = [
  server,
  atlasSync,
  worker,
  openrouter,
  onchain,
  analytics,
  auth,
  previews,
  chatModels,
  chatFacts,
  chatVerify,
  chatLimits,
  feedback,
  dev,
  platform,
];
