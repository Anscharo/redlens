# ─── Stage 1: builder ────────────────────────────────────────────────────────
# Clones the atlas, builds all artifacts and the Vite bundle. Heavy tools
# (git, python3) stay in this layer and never reach the runtime image.
FROM oven/bun:1.3 AS builder

RUN apt-get update \
 && apt-get install -y --no-install-recommends git python3 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN bun install

COPY . .

# Clone the atlas. Railway strips .git from the build context so submodule
# init cannot work — a direct clone gives us the content we need.
# Chat + auth ship DISABLED by default; rebuild with --build-arg
# VITE_CHAT_ENABLED=1 (and set CHAT_ENABLED=1 at runtime) to enable.
ARG VITE_CHAT_ENABLED=0
RUN rm -rf vendor/next-gen-atlas \
 && git clone --depth 1 --single-branch --branch main \
      https://github.com/sky-ecosystem/next-gen-atlas vendor/next-gen-atlas \
 && RAILWAY_ENVIRONMENT=production VITE_CHAT_ENABLED=$VITE_CHAT_ENABLED \
    bun run build:index \
 && bun run build:graph \
 && bun run build:glossary \
 && RAILWAY_ENVIRONMENT=production VITE_CHAT_ENABLED=$VITE_CHAT_ENABLED \
    bun run build:ts \
 && RAILWAY_ENVIRONMENT=production VITE_CHAT_ENABLED=$VITE_CHAT_ENABLED \
    bun run build:vite \
 && gzip -9 -k dist/docs.json dist/search-index.json dist/relations.json dist/glossary.json

# ─── Stage 2: runtime ────────────────────────────────────────────────────────
# Lean image — no git, no python3, no atlas source, no build toolchain.
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

ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "start"]
