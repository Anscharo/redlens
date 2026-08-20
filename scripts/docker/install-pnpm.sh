#!/bin/sh
# Install pnpm's standalone build into $PNPM_HOME.
#
# Shared by Dockerfile and Dockerfile.worker so the two images cannot drift.
# They were byte-identical copies, and duplication across these two files has
# already produced a bug once: an ENV added to one stage and missed in another.
#
# oven/bun ships no Node, so corepack — which comes with Node — is unavailable.
# pnpm's standalone build bundles its own Node, which is what these images need.
# It comes from the npm registry the install already depends on, not a
# third-party installer host, and the version is READ FROM package.json's
# packageManager field so the image and the repo cannot disagree.
#
# Requires: $PNPM_HOME set, curl + tar available, and package.json in $PWD.
set -eux

ver="$(sed -n 's/.*"packageManager": *"pnpm@\([^"]*\)".*/\1/p' package.json)"
test -n "$ver"

case "$(dpkg --print-architecture)" in
  amd64) pkg=linux-x64 ;;
  arm64) pkg=linux-arm64 ;;
  *) echo "unsupported architecture for the pnpm standalone build" >&2; exit 1 ;;
esac

mkdir -p "$PNPM_HOME"
curl -fsSL "https://registry.npmjs.org/@pnpm/${pkg}/-/${pkg}-${ver}.tgz" \
  | tar -xz -C "$PNPM_HOME" --strip-components=1 package/pnpm
chmod +x "$PNPM_HOME/pnpm"
"$PNPM_HOME/pnpm" --version
