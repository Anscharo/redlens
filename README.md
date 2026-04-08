# RedLens — Sky Atlas

A search-first reader for the [Sky Atlas](https://github.com/sky-ecosystem/next-gen-atlas), the canonical document describing the Sky ecosystem's structure, governance, and operations.

An alternative to [sky-atlas.io](https://sky-atlas.io) with a focus on:

- **Fast full-content search** — every node of the Atlas is indexed (lunr.js, in a Web Worker), so queries hit the entire ~48k-line corpus instantly.
- **On-chain annotations** — addresses mentioned in the Atlas are detected at build time, classified by chain and role, and linked to the appropriate block explorer. The goal is to surface live on-chain context (balances, holdings) next to the governance text that references them.

## Build & run locally

Requires [pnpm](https://pnpm.io/) and Node 22+.

```bash
# clone with the Atlas submodule
git clone --recurse-submodules https://github.com/Anscharo/redlens.git
cd redlens

pnpm install
pnpm build:index   # parses the Atlas markdown into docs.json + search-index.json
pnpm dev           # start the Vite dev server
```

If you cloned without `--recurse-submodules`, run:

```bash
git submodule update --init --recursive
```

To produce a production build:

```bash
pnpm build         # runs build:index, then tsc + vite build
pnpm preview       # serve the built site locally
```

## Deployment

`main` is auto-deployed to GitHub Pages via `.github/workflows/deploy.yml`. The workflow also runs on a daily schedule, pulling the latest upstream Atlas content on each build.
