# Dev container for Rat Scout (Pebble SDK 4.x via pebble-tool 5.x).
#
# Ubuntu 24.04 is required: the SDK's emulator needs glibc >= 2.38.
# See https://developer.repebble.com/sdk/ for the official dependency list.
FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04

# System packages:
#   nodejs npm                      – SDK JS bundling (webpack) + test/*.test.js
#   libsdl2-2.0-0 libglib2.0-0
#   libpixman-1-0 zlib1g libsndio7.0 – qemu-pebble runtime libraries (official list)
#   xvfb x11-utils                  – headless X display for scripts/run-emulator.sh
#   novnc                           – browser-based emulator viewer on port 6080
#   qemu-system-data                – QEMU keymaps (fallback for SDKs that lack them)
#   iproute2                        – `ss`, used by run-emulator.sh port checks
RUN apt-get update \
    && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl git python3 \
        nodejs npm \
        libsdl2-2.0-0 libglib2.0-0 libpixman-1-0 zlib1g libsndio7.0 \
        xvfb x11-utils novnc qemu-system-data iproute2 \
    && rm -rf /var/lib/apt/lists/*

# uv + pebble-tool, installed system-wide so `pebble` is on PATH for every
# user and shell.  pebble-tool requires Python 3.10–3.13; uv fetches 3.13.
# The tool venv is made world-writable because run-emulator.sh temporarily
# swaps pebble_tool/util/browser.py with scripts/browser_override.py.
ENV UV_INSTALL_DIR=/usr/local/bin \
    UV_TOOL_DIR=/opt/uv/tools \
    UV_TOOL_BIN_DIR=/usr/local/bin \
    UV_PYTHON_INSTALL_DIR=/opt/uv/python
RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh \
    && uv tool install pebble-tool --python 3.13 \
    && chmod -R a+rwX /opt/uv
