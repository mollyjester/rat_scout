#!/usr/bin/env bash
# setup.sh — post-create step for the dev container (idempotent; safe to re-run).
#
# Installs the per-user pieces the image cannot bake in: the Pebble SDK lives
# under $HOME (~/.local/share/pebble-sdk), and node_modules lives in the repo.
# Also works outside the dev container on Ubuntu 24.04 if the packages listed
# in .devcontainer/Dockerfile are installed.

set -euo pipefail

cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"

if ! command -v uv &>/dev/null; then
    echo "==> Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
fi

if ! command -v pebble &>/dev/null; then
    echo "==> Installing pebble-tool..."
    uv tool install pebble-tool --python 3.13
fi

if ! pebble sdk list 2>/dev/null | grep -q '(active)'; then
    echo "==> Installing latest Pebble SDK..."
    pebble sdk install latest
fi

echo "==> Installing npm dependencies..."
npm ci --no-audit --no-fund

echo "==> Done. Try: pebble build && ./scripts/run-emulator.sh"
