# RedLens Atlas — single-stage image (deliberately NOT multi-stage / slim).
# The in-process atlas updater re-runs build-index/build-graph and `git fetch` at
# RUNTIME, so the final image MUST carry: bun, git, python3, the build scripts,
# node_modules, and a real atlas git checkout. A slim runtime stage would break
# the updater — that's why this is one stage.
FROM oven/bun:1.3

# git: clone the atlas at build time + the runtime self-update fetch.
# python3: build-index runs the atlas's sync/compose.py (stdlib only) to
#   synthesize the monolithic "Sky Atlas.md" from content/** — it is generated,
#   not committed, so the updater needs python3 at RUNTIME too.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates python3 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Deps first so this layer caches across source-only changes.
COPY package.json ./
RUN bun install

# Then the repo (node_modules/dist/.git/vendor excluded via .dockerignore).
COPY . .

# Railway strips .git from the Docker build context, so `git submodule update`
# cannot work here. Clone the atlas directly — this also gives the runtime
# updater a clean origin/main to `git fetch` into. Tracks main (matches the
# in-process-updater design); to pin a version, `git checkout <sha>` after clone.
# Then build the lean artifact set (build:railway skips the Etherscan/RPC passes
# — those artifacts are committed and ship in the image).
# RAILWAY_ENVIRONMENT forces the Vite base to apex "/" (vite.config.ts). Railway
# does NOT inject its runtime vars into the Docker build, so without this the
# bundle builds with the GH-Pages base "/redlens/" and every asset 404s → SPA
# fallback serves index.html as text/html → "module script MIME type" errors.
#
# Chat + auth ship DISABLED. __CHAT_ENABLED__ is baked into the bundle at build
# time, so enabling the UI takes a build arg (runtime Railway vars can't reach
# Vite). To turn it on: build with --build-arg VITE_CHAT_ENABLED=1 AND set
# CHAT_ENABLED=1 + the OAuth/JWT vars as Railway runtime variables.
ARG VITE_CHAT_ENABLED=0
RUN rm -rf vendor/next-gen-atlas \
 && git clone --depth 1 --single-branch --branch main \
      https://github.com/sky-ecosystem/next-gen-atlas vendor/next-gen-atlas \
 && RAILWAY_ENVIRONMENT=production VITE_CHAT_ENABLED=$VITE_CHAT_ENABLED bun run build:railway

ENV PORT=3000
EXPOSE 3000

# Ordering invariant: PG current (sync:atlas, sha-gated → fast on steady-state
# boots) before the in-memory indexes load + serve.
CMD ["sh", "-c", "bun run sync:atlas && bun run start"]
