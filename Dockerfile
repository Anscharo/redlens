# ─── Stage 1: builder ────────────────────────────────────────────────────────
# Clones the atlas, builds all artifacts and the Vite bundle. Heavy tools
# (git) stay in this layer and never reach the runtime image.
FROM oven/bun:1.3 AS builder

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json ./apps/web/

# pnpm is the repo's only package manager — one lockfile, exercised by every CI
# job. Bun stays the RUNTIME (start command, the bun-runner build steps, the
# worker); it is just not the installer any more.
#
# oven/bun ships no Node (see oven-sh/bun dockerhub/debian/Dockerfile), so
# corepack — which comes with Node — is not available here. pnpm's standalone
# build bundles its own Node, which is exactly what this image needs.
#
# .npmrc turns on engine-strict and package.json pins engines.node >= 22 — a
# guard for local dev and CI, where a transitive dep needs it. pnpm's standalone
# build bundles its own Node (v20.11.1 in 10.33.0), so engine-strict measures THAT
# interpreter against a constraint meant for the dev toolchain and refuses. There
# is no Node in this image at all; the runtime here is Bun.
#
# ENV rather than an .npmrc line for two reasons: `COPY . .` lands after the
# install and would clobber an edited file, and pnpm enforces engines when it RUNS
# a script too — which `build:vite` does, delegating through
# `pnpm --filter @redlens/web`. A per-command flag covered only `pnpm install`.
ENV npm_config_engine_strict=false

ENV PNPM_HOME="/usr/local/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# pnpm's standalone build, straight from the npm registry the install already
# needs — no third-party installer host, and the version is READ FROM
# package.json's packageManager field rather than repeated here, so the image
# and the repo cannot drift apart.
RUN set -eux; \
    ver="$(sed -n 's/.*"packageManager": *"pnpm@\([^"]*\)".*/\1/p' package.json)"; \
    test -n "$ver"; \
    case "$(dpkg --print-architecture)" in \
      amd64) pkg=linux-x64 ;; \
      arm64) pkg=linux-arm64 ;; \
      *) echo "unsupported architecture for the pnpm standalone build" >&2; exit 1 ;; \
    esac; \
    mkdir -p "$PNPM_HOME"; \
    curl -fsSL "https://registry.npmjs.org/@pnpm/${pkg}/-/${pkg}-${ver}.tgz" \
      | tar -xz -C "$PNPM_HOME" --strip-components=1 package/pnpm; \
    chmod +x "$PNPM_HOME/pnpm"; \
    pnpm --version

RUN pnpm install --frozen-lockfile

COPY . .

# Clone the atlas. Railway strips .git from the build context so submodule
# init cannot work — a direct clone gives us the content we need. Stamp
# ATLAS_COMMIT from that clone: `git rev-parse` inside bun/node can fail
# (dubious-ownership) and silently write atlasCommit "unknown", which then
# never matches Postgres and E2E waits forever on /api/health.
# Login features (auth, saved Collections) + chat ship DISABLED by default, gated
# by two runtime service variables: USERS_ENABLED (auth + Collections) and
# CHAT_ENABLED (chat, which additionally requires users). Railway forwards a
# service variable as a --build-arg when the matching ARG is declared, so
# declaring ARG USERS_ENABLED / ARG CHAT_ENABLED both (a) documents the runtime
# knobs (config.ts reads USERS_ENABLED / CHAT_ENABLED) and (b) flows into the
# VITE_* build flags below, baking the matching frontend bundle in. No hardcoding
# to production — any env with USERS_ENABLED=1 gets logins; add CHAT_ENABLED=1 for
# chat. The VITE_* flags can still be overridden explicitly (e.g. a manual
# `docker build --build-arg VITE_CHAT_ENABLED=1`). Chat needs a logged-in session,
# so VITE_CHAT_ENABLED=1 without the USERS flags leaves chat off.
ARG USERS_ENABLED=0
ARG CHAT_ENABLED=0
ARG VITE_USERS_ENABLED=$USERS_ENABLED
ARG VITE_CHAT_ENABLED=$CHAT_ENABLED
# PostHog analytics key. VITE_* vars are inlined by Vite AT BUILD TIME, not read
# at runtime — so the key must be present in this build environment, not just as a
# runtime service variable. Railway forwards the matching service variable as a
# --build-arg when this ARG is declared. Empty by default → analytics stays a
# no-op (analyticsEnabled=false in src/lib/analytics.ts).
ARG VITE_POSTHOG_KEY=""
# App build provenance: this image has no .git (COPY . . above copies source
# only), so vite.config.ts's `git rev-parse --short HEAD` always fails here and
# __COMMIT_HASH__ would default to "dev". Railway auto-populates
# RAILWAY_GIT_COMMIT_SHA as a service variable (already read at runtime by
# config.ts's appCommit); declaring the matching ARG makes Railway forward it
# as a build-arg too, so vite.config.ts's fallback chain can pick it up.
ARG RAILWAY_GIT_COMMIT_SHA=""
RUN rm -rf vendor/next-gen-atlas \
 && git clone --depth 1 --single-branch --branch main \
      https://github.com/sky-ecosystem/next-gen-atlas vendor/next-gen-atlas \
 && git config --global --add safe.directory /app/vendor/next-gen-atlas \
 && export ATLAS_COMMIT="$(git -C vendor/next-gen-atlas rev-parse HEAD)" \
 && test -n "$ATLAS_COMMIT" \
 && echo "Dockerfile: atlas ${ATLAS_COMMIT}" \
 && bun run build:index \
 && bun run build:graph \
 && bun run build:glossary \
 && bun run build:oea-report \
 && bun run build:bundle \
 && bun run build:tools \
 && VITE_USERS_ENABLED=$VITE_USERS_ENABLED VITE_CHAT_ENABLED=$VITE_CHAT_ENABLED bun run build:ts \
 && VITE_USERS_ENABLED=$VITE_USERS_ENABLED VITE_CHAT_ENABLED=$VITE_CHAT_ENABLED VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY RAILWAY_GIT_COMMIT_SHA=$RAILWAY_GIT_COMMIT_SHA bun run build:vite \
 && gzip -9 -k dist/docs.json dist/search-index.json dist/relations.json dist/glossary.json dist/oea-report.json

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
# Lean image — no git, no atlas source, no build toolchain.
# Atlas artifacts are baked in from the builder stage so the server has
# data from the first request. The in-process updater keeps them fresh
# from Postgres once the atlas worker populates it.
FROM oven/bun:1.3

WORKDIR /app

# Production dependencies only, installed fresh — the builder's node_modules
# carries the whole toolchain (vite, tailwind, typescript, vitest, playwright,
# jsdom, knip, oxlint) that this image never runs. The pnpm binary is copied
# rather than re-downloaded so this stage needs no curl and no network beyond
# the registry.
#
# Same reason as the builder stage — ENV does not cross a FROM boundary.
ENV npm_config_engine_strict=false
ENV PNPM_HOME="/usr/local/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
COPY --from=builder /usr/local/pnpm       /usr/local/pnpm
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json ./apps/web/
# --filter lens: install the ROOT package's dependencies only. A bare workspace
# install would resolve apps/web too and drag react, vite, katex and the rest of
# the browser bundle into an image that never renders anything. Every workspace
# manifest still has to be present for pnpm to resolve the lockfile, hence the
# apps/web/package.json copy above.
#
# Store removal is in the same layer so the space is actually reclaimed; the
# store hardlinks into node_modules, so the installed tree survives it.
RUN pnpm install --frozen-lockfile --prod --filter lens \
 && rm -rf "$(pnpm store path)"

COPY --from=builder /app/dist             ./dist
COPY --from=builder /app/src/server       ./src/server
COPY --from=builder /app/src/lib          ./src/lib
# The chain registry is read at RUNTIME, not just at build time: src/lib
# (explorer.ts, tokens.ts) imports it, and scripts/lib/chains.mjs reads it off
# disk — so the atlas worker and the balances fetcher both need it present.
# Omitting it leaves the image importing a file that isn't there.
COPY --from=builder /app/src/data          ./src/data
COPY --from=builder /app/scripts/required ./scripts/required
COPY --from=builder /app/scripts/lib      ./scripts/lib

# Vite copies public/ into dist/ at build time, so dist/ already has all
# atlas artifacts. Symlink public/ → dist/ so the server's config.publicDir
# and the in-process updater's write path both resolve to the same directory.
RUN ln -s /app/dist /app/public

EXPOSE 8080

CMD ["bun", "run", "start"]
