# ─── Stage 1: builder ────────────────────────────────────────────────────────
# Clones the atlas, builds all artifacts and the Vite bundle. Heavy tools
# (git) stay in this layer and never reach the runtime image.
FROM oven/bun:1.3 AS builder

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .

# Clone the atlas. Railway strips .git from the build context so submodule
# init cannot work — a direct clone gives us the content we need.
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
RUN rm -rf vendor/next-gen-atlas \
 && git clone --depth 1 --single-branch --branch main \
      https://github.com/sky-ecosystem/next-gen-atlas vendor/next-gen-atlas \
 && bun run build:index \
 && bun run build:graph \
 && bun run build:glossary \
 && bun run build:oea-report \
 && bun run build:bundle \
 && bun run build:tools \
 && VITE_USERS_ENABLED=$VITE_USERS_ENABLED VITE_CHAT_ENABLED=$VITE_CHAT_ENABLED bun run build:ts \
 && VITE_USERS_ENABLED=$VITE_USERS_ENABLED VITE_CHAT_ENABLED=$VITE_CHAT_ENABLED VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY bun run build:vite \
 && gzip -9 -k dist/docs.json dist/search-index.json dist/relations.json dist/glossary.json dist/oea-report.json

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
# Lean image — no git, no atlas source, no build toolchain.
# Atlas artifacts are baked in from the builder stage so the server has
# data from the first request. The in-process updater keeps them fresh
# from Postgres once the atlas worker populates it.
FROM oven/bun:1.3

WORKDIR /app

COPY --from=builder /app/node_modules      ./node_modules
COPY --from=builder /app/dist             ./dist
COPY --from=builder /app/src/server       ./src/server
COPY --from=builder /app/src/lib          ./src/lib
COPY --from=builder /app/scripts/required ./scripts/required
COPY --from=builder /app/scripts/lib      ./scripts/lib
COPY --from=builder /app/package.json     ./

# Vite copies public/ into dist/ at build time, so dist/ already has all
# atlas artifacts. Symlink public/ → dist/ so the server's config.publicDir
# and the in-process updater's write path both resolve to the same directory.
RUN ln -s /app/dist /app/public

EXPOSE 8080

CMD ["bun", "run", "start"]
