#!/usr/bin/env bash
# run-emulator.sh — Run the Rat Scout Pebble watchface in the Pebble emulator.
#
# Designed for GitHub Codespaces but also works locally.
# In a Codespace, the config page URL will appear in the terminal and can be
# opened via port forwarding (VS Code will prompt to open it in a browser).
#
# Usage: ./scripts/run-emulator.sh [--platform <platform>] [--logs] [--help]

set -e

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
PLATFORM="basalt"
SHOW_LOGS=false
VALID_PLATFORMS="aplite basalt chalk diorite emery"

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --platform)
            PLATFORM="$2"
            shift 2
            ;;
        --logs)
            SHOW_LOGS=true
            shift
            ;;
        --help|-h)
            cat <<EOF
Usage: ./scripts/run-emulator.sh [OPTIONS]

Run the Rat Scout Pebble watchface in the Pebble emulator.

OPTIONS:
  --platform <name>   Emulator platform to use (default: basalt)
                      Valid values: aplite, basalt, chalk, diorite, emery
  --logs              Tail pebble logs in the background (shows JS console output)
  --help, -h          Show this help message

EXAMPLES:
  ./scripts/run-emulator.sh
  ./scripts/run-emulator.sh --platform diorite --logs
  ./scripts/run-emulator.sh --platform aplite

In a GitHub Codespace the config page URL will be printed in the terminal.
VS Code will offer to open the forwarded port in your browser automatically.
EOF
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            echo "Run with --help for usage." >&2
            exit 1
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Validate platform
# ---------------------------------------------------------------------------
VALID=false
for P in $VALID_PLATFORMS; do
    if [[ "$PLATFORM" == "$P" ]]; then
        VALID=true
        break
    fi
done
if [[ "$VALID" == "false" ]]; then
    echo "Error: invalid platform '$PLATFORM'. Valid values: $VALID_PLATFORMS" >&2
    exit 1
fi

echo "==> Platform: $PLATFORM"

# ---------------------------------------------------------------------------
# Install system dependencies if missing
# ---------------------------------------------------------------------------
if ! dpkg -l libsdl1.2debian &>/dev/null || ! dpkg -l libfdt1 &>/dev/null; then
    echo "==> Installing system dependencies..."
    sudo apt-get update -q
    sudo apt-get install -y libsdl1.2debian libfdt1
fi

# ---------------------------------------------------------------------------
# Install Pebble SDK if not present
# ---------------------------------------------------------------------------
if ! command -v pebble &>/dev/null; then
    echo "==> Installing pebble-tool via uv..."
    if ! command -v uv &>/dev/null; then
        echo "Error: 'uv' is not installed. Install it from https://github.com/astral-sh/uv" >&2
        exit 1
    fi
    uv tool install pebble-tool --python 3.13
fi

if ! pebble sdk list 2>/dev/null | grep -q 'current'; then
    echo "==> Installing latest Pebble SDK..."
    pebble sdk install latest
fi

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
echo "==> Building..."
pebble clean
pebble build

# ---------------------------------------------------------------------------
# Install to emulator
# ---------------------------------------------------------------------------
echo "==> Starting emulator ($PLATFORM) and installing app..."
pebble install --emulator "$PLATFORM"

# ---------------------------------------------------------------------------
# Optionally tail logs
# ---------------------------------------------------------------------------
if [[ "$SHOW_LOGS" == "true" ]]; then
    echo "==> Tailing pebble logs in background (Ctrl+C to stop)..."
    pebble logs --emulator "$PLATFORM" &
    LOGS_PID=$!
fi

# Give the emulator a moment to fully start
sleep 3

# ---------------------------------------------------------------------------
# Open config/settings page
# ---------------------------------------------------------------------------
echo "==> Opening config page..."
pebble emu-app-config --emulator "$PLATFORM"

# ---------------------------------------------------------------------------
# Info
# ---------------------------------------------------------------------------
cat <<INFO

==========================================================
  Rat Scout is running on the $PLATFORM emulator.

  In a GitHub Codespace:
    The config page URL will appear above. VS Code will
    offer to open the forwarded port in your browser.

  Press Ctrl+C to stop.
==========================================================
INFO

# Keep running until the user interrupts
trap 'echo; echo "==> Stopping..."; [[ -n "${LOGS_PID:-}" ]] && kill "$LOGS_PID" 2>/dev/null; exit 0' INT TERM
wait
