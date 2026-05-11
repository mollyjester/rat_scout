#!/usr/bin/env bash
# run-emulator.sh — Run the Rat Scout Pebble watchface in the Pebble emulator.
#
# Designed for GitHub Codespaces but also works locally.
# In a Codespace the config page URL is printed in the terminal and VS Code
# will auto-forward the port so you can open it in your browser.
#
# NOTE: This script relies on .devcontainer/devcontainer.json to declare
#       port 6080 (noVNC / websockify) as public.  If you are running in a
#       Codespace that was created *before* that file existed, you must
#       either rebuild the container or manually set port 6080 to "Public"
#       in the VS Code Ports tab for the emulator display to be reachable
#       from your external browser.
#
# Usage: ./scripts/run-emulator.sh [--platform <platform>] [--loc <name>] [--logs] [--help]

set -e

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------
PLATFORM="flint"
VALID_PLATFORMS="flint emery"
LOCATION_NAME=""
SKIP_BUILD=true
SETTINGS_FILE=""

# ---------------------------------------------------------------------------
# Cleanup helper — kills the emulator and Xvfb if we launched them
# ---------------------------------------------------------------------------
CLEANUP_EXIT_CODE=0
BROWSER_PY_BACKUP=""   # set later; used by cleanup to restore original
GEO_PY_BACKUP=""      # set later; used by cleanup to restore original geolocation.py
cleanup() {
    # Avoid re-triggering the trap on EXIT while we're already cleaning up
    trap - EXIT INT TERM
    echo
    echo "==> Stopping..."
    # Kill emulator processes spawned by the pebble tool
    pkill -f "qemu.*pebble" 2>/dev/null || true
    pkill -f pypkjs 2>/dev/null || true
    pkill -f 'websockify.*6080' 2>/dev/null || true
    if [[ -n "${XVFB_PID:-}" ]]; then
        kill "$XVFB_PID" 2>/dev/null || true
        rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || true
    fi
    # Restore the original browser.py if we swapped it
    if [[ -n "$BROWSER_PY_BACKUP" && -f "$BROWSER_PY_BACKUP" ]]; then
        mv -f "$BROWSER_PY_BACKUP" "${BROWSER_PY_BACKUP%.orig}"
        # Clear bytecode cache so Python picks up the restored file
        find "$(dirname "$BROWSER_PY_BACKUP")" -path '*/__pycache__/browser*' -delete 2>/dev/null || true
        echo "==> Restored original browser.py"
    fi
    # Restore the original geolocation.py if we swapped it
    if [[ -n "$GEO_PY_BACKUP" && -f "$GEO_PY_BACKUP" ]]; then
        mv -f "$GEO_PY_BACKUP" "${GEO_PY_BACKUP%.orig}"
        find "$(dirname "$GEO_PY_BACKUP")" -path '*/__pycache__/geolocation*' -delete 2>/dev/null || true
        echo "==> Restored original geolocation.py"
    fi
    exit "$CLEANUP_EXIT_CODE"
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --platform)
            PLATFORM="$2"
            shift 2
            ;;
        --loc)
            LOCATION_NAME="$2"
            shift 2
            ;;
        --build)
            SKIP_BUILD=false
            shift
            ;;
        --settings)
            # Resolve to absolute path now, before the script cd's to PROJECT_ROOT
            SETTINGS_FILE="$(cd "$(dirname "$2")" 2>/dev/null && pwd)/$(basename "$2")"
            shift 2
            ;;
        --logs)
            # Accepted for backward compatibility; logs are always shown now
            shift
            ;;
        --help|-h)
            cat <<EOF
Usage: ./scripts/run-emulator.sh [OPTIONS]

Run the Rat Scout Pebble watchface in the Pebble emulator.

OPTIONS:
  --platform <name>   Emulator platform to use (default: flint)
                      Valid values: flint emery
  --loc <name>        Override emulator location (e.g. Malta, Moscow, Tokyo)
                      Sets timezone, provides fixed GPS coordinates to weather
                      and astronomy APIs. Uses Open-Meteo geocoding (no key).
  --settings <file>   JSON file with watchface settings to pre-seed into the
                      emulator's localStorage before launch. Keys set to null
                      are omitted so Clay uses its built-in defaults. See
                      scripts/settings.json for a template with all keys.
  --build             Run pebble clean + pebble build before installing.
                      By default the build step is skipped.
  --logs              Accepted for backward compatibility (logs are always shown)
  --help, -h          Show this help message

EXAMPLES:
  ./scripts/run-emulator.sh
  ./scripts/run-emulator.sh --platform emery
  ./scripts/run-emulator.sh --loc Malta
  ./scripts/run-emulator.sh --settings scripts/settings.json
  ./scripts/run-emulator.sh --platform flint --loc Moscow --settings scripts/settings.json

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
# Resolve --loc (geocode location name → lat/lon/timezone)
#
# Uses the Open-Meteo Geocoding API (free, no API key required).
# Sets environment variables used by:
#   - TZ                → pebble-tool sends correct timezone to emulator
#   - PEBBLE_GEO_LAT   → geolocation_override.py returns these coords
#   - PEBBLE_GEO_LON
# ---------------------------------------------------------------------------
if [[ -n "$LOCATION_NAME" ]]; then
    echo "==> Resolving location: $LOCATION_NAME"
    ENCODED_NAME="$(python3 -c "import urllib.parse; print(urllib.parse.quote('$LOCATION_NAME'))")"
    GEO_JSON="$(curl -sf "https://geocoding-api.open-meteo.com/v1/search?name=${ENCODED_NAME}&count=1&language=en")"
    if [[ -z "$GEO_JSON" ]]; then
        echo "Error: geocoding API request failed (network error)." >&2
        exit 1
    fi

    # Parse the result
    GEO_RESULT="$(echo "$GEO_JSON" | python3 -c "
import json, sys
data = json.load(sys.stdin)
results = data.get('results', [])
if not results:
    print('NOT_FOUND')
else:
    r = results[0]
    print('{lat}|{lon}|{tz}|{name}|{country}'.format(
        lat=r['latitude'], lon=r['longitude'],
        tz=r.get('timezone', ''), name=r['name'],
        country=r.get('country', '')))
")"

    if [[ "$GEO_RESULT" == "NOT_FOUND" ]]; then
        echo "Error: could not resolve location '$LOCATION_NAME'." >&2
        echo "       Try a well-known city name (e.g. Malta, Moscow, Tokyo)." >&2
        exit 1
    fi

    IFS='|' read -r GEO_LAT GEO_LON GEO_TZ GEO_NAME GEO_COUNTRY <<< "$GEO_RESULT"
    export PEBBLE_GEO_LAT="$GEO_LAT"
    export PEBBLE_GEO_LON="$GEO_LON"

    echo "    Resolved: $GEO_NAME, $GEO_COUNTRY"
    echo "    Coordinates: $GEO_LAT, $GEO_LON"
    echo "    Timezone: $GEO_TZ"

    if [[ -n "$GEO_TZ" ]]; then
        export TZ="$GEO_TZ"
        echo "    TZ=$TZ (emulator will display local time for $GEO_NAME)"
    fi
fi

# ---------------------------------------------------------------------------
# Change to the project root (directory containing this script's parent)
# ---------------------------------------------------------------------------
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"
echo "==> Project root: $PROJECT_ROOT"

# ---------------------------------------------------------------------------
# Install system dependencies if missing (include Xvfb for headless display)
# ---------------------------------------------------------------------------
NEED_PKGS=()
dpkg -l libsdl1.2debian  &>/dev/null || NEED_PKGS+=(libsdl1.2debian)
dpkg -l libfdt1           &>/dev/null || NEED_PKGS+=(libfdt1)
dpkg -l xvfb              &>/dev/null || NEED_PKGS+=(xvfb)
dpkg -l x11-utils         &>/dev/null || NEED_PKGS+=(x11-utils)  # for xdpyinfo
dpkg -l novnc             &>/dev/null || NEED_PKGS+=(novnc)      # web-based VNC viewer
dpkg -l qemu-system-data  &>/dev/null || NEED_PKGS+=(qemu-system-data)  # keymaps for qemu-pebble

if [[ ${#NEED_PKGS[@]} -gt 0 ]]; then
    echo "==> Installing system dependencies: ${NEED_PKGS[*]}..."
    sudo apt-get update -q
    sudo apt-get install -y "${NEED_PKGS[@]}"
fi

# pebble-tool invokes qemu-pebble with -L <sdk>/toolchain/lib/pc-bios, so qemu-pebble
# looks for keymaps at <sdk>/toolchain/lib/pc-bios/keymaps/en-us.  That directory is
# not shipped with the SDK, but qemu-system-data installs the keymaps to
# /usr/share/qemu/keymaps.  Symlink them into every active SDK's pc-bios dir.
for SDK_DIR in /home/codespace/.pebble-sdk/SDKs/*/toolchain; do
    PC_BIOS="${SDK_DIR}/lib/pc-bios"
    if [[ ! -e "${PC_BIOS}/keymaps" ]]; then
        mkdir -p "$PC_BIOS"
        ln -sf /usr/share/qemu/keymaps "${PC_BIOS}/keymaps"
    fi
done

# ---------------------------------------------------------------------------
# Ensure a DISPLAY is available (start Xvfb if headless)
# ---------------------------------------------------------------------------

# Kill stale emulator / Xvfb processes from previous runs so ports and
# display :99 are available.
echo "==> Cleaning up stale processes..."
pkill -9 -f 'qemu.*pebble' 2>/dev/null || true
pkill -9 -f pypkjs 2>/dev/null || true
pkill -9 -f 'websockify.*6080' 2>/dev/null || true
pkill -9 -f 'Xvfb :99' 2>/dev/null || true
rm -f /tmp/pb-emulator.json /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || true
sleep 1

start_xvfb() {
    # Clean stale lock files that prevent Xvfb from binding to :99
    rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || true
    Xvfb :99 -screen 0 400x400x24 &>/dev/null &
    XVFB_PID=$!
    export DISPLAY=:99
    sleep 1
    # Verify Xvfb actually started
    if ! kill -0 "$XVFB_PID" 2>/dev/null; then
        echo "Error: Xvfb failed to start" >&2
        exit 1
    fi
}

if [[ -z "${DISPLAY:-}" ]]; then
    echo "==> No DISPLAY detected — starting Xvfb..."
    start_xvfb
else
    # DISPLAY is set but the X server may have died (e.g. stale env var).
    # Try a quick probe; if it fails, restart Xvfb.
    if ! xdpyinfo -display "$DISPLAY" &>/dev/null 2>&1; then
        echo "==> DISPLAY=$DISPLAY is set but unreachable — restarting Xvfb..."
        pkill -f 'Xvfb :99' 2>/dev/null || true
        sleep 0.5
        start_xvfb
    fi
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

if ! pebble sdk list 2>/dev/null | grep -q '(active)'; then
    echo "==> Installing latest Pebble SDK..."
    pebble sdk install latest
fi

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
if [[ "$SKIP_BUILD" == "false" ]]; then
    echo "==> Building..."
    pebble clean
    pebble build
else
    echo "==> Skipping build (use --build to force a clean build)"
fi

# ---------------------------------------------------------------------------
# Temporarily swap browser.py with our override
#
# Clay embeds the entire settings-page HTML in the URL hash fragment
# (100 KB+), which breaks VS Code Simple Browser.  Our override extracts
# the HTML, injects the return_to callback, and serves it from a local
# HTTP endpoint (/config) so the URL stays short.
#
# We swap the file at runtime and restore the original on exit so SDK
# upgrades are never affected.
# ---------------------------------------------------------------------------
BROWSER_PY=""
# pebble-tool lives in its own virtualenv — use its Python to locate browser.py
PEBBLE_PYTHON="$(head -1 "$(which pebble)" | sed 's/^#!//')"
BROWSER_PY="$("$PEBBLE_PYTHON" -c "import pebble_tool.util.browser; print(pebble_tool.util.browser.__file__)" 2>/dev/null || true)"

if [[ -n "$BROWSER_PY" && -f "$BROWSER_PY" ]]; then
    cp -f "$BROWSER_PY" "${BROWSER_PY}.orig"
    BROWSER_PY_BACKUP="${BROWSER_PY}.orig"
    cp -f "${PROJECT_ROOT}/scripts/browser_override.py" "$BROWSER_PY"
    # Clear bytecode cache so Python picks up our override
    find "$(dirname "$BROWSER_PY")" -path '*/__pycache__/browser*' -delete 2>/dev/null || true
    echo "==> Swapped browser.py with config-page override (will restore on exit)"
else
    echo "WARNING: Could not locate browser.py — config page may show raw URL" >&2
fi

# ---------------------------------------------------------------------------
# Temporarily swap geolocation.py with our override (when --loc is used)
#
# pypkjs resolves navigator.geolocation.getCurrentPosition() via IP lookup
# (ipify.org + GeoLiteCity.dat), which returns the data centre's location
# in a Codespace.  When --loc is specified, we swap in our override that
# returns fixed lat/lon from PEBBLE_GEO_LAT / PEBBLE_GEO_LON environment
# variables.  The original is restored on exit.
# ---------------------------------------------------------------------------
if [[ -n "${PEBBLE_GEO_LAT:-}" && -n "${PEBBLE_GEO_LON:-}" ]]; then
    GEO_PY="$("$PEBBLE_PYTHON" -c "
from pypkjs.javascript.navigator import geolocation as _g
print(_g.__file__)
" 2>/dev/null || true)"

    if [[ -n "$GEO_PY" && -f "$GEO_PY" ]]; then
        cp -f "$GEO_PY" "${GEO_PY}.orig"
        GEO_PY_BACKUP="${GEO_PY}.orig"
        cp -f "${PROJECT_ROOT}/scripts/geolocation_override.py" "$GEO_PY"
        find "$(dirname "$GEO_PY")" -path '*/__pycache__/geolocation*' -delete 2>/dev/null || true
        echo "==> Swapped geolocation.py with location override (lat=$PEBBLE_GEO_LAT lon=$PEBBLE_GEO_LON)"
    else
        echo "WARNING: Could not locate pypkjs geolocation.py — weather/astronomy will use IP-based location" >&2
    fi
fi

# ---------------------------------------------------------------------------
# Pre-seed emulator localStorage with settings from --settings file.
#
# pypkjs stores localStorage as a dbm.dumb database keyed by app UUID at:
#   ~/.pebble-sdk/<sdk>/<platform>/localstorage/<uuid>.{dat,dir}
#
# We write a 'clay-settings' key containing only the non-null values from
# the provided JSON file.  Missing/null keys are omitted, so Clay falls back
# to the defaultValue defined in config.json for each of those settings.
#
# seed_localstorage() is called before the first install attempt AND after
# every 'pebble wipe' in the retry loop — wipe deletes the entire persist
# dir (including localstorage), so we must re-seed before the next attempt.
# ---------------------------------------------------------------------------
if [[ -n "$SETTINGS_FILE" ]]; then
    if [[ ! -f "$SETTINGS_FILE" ]]; then
        echo "Error: settings file not found: $SETTINGS_FILE" >&2
        exit 1
    fi
fi

seed_localstorage() {
    [[ -z "$SETTINGS_FILE" ]] && return 0
    echo "==> Seeding emulator localStorage from $SETTINGS_FILE..."
    "$PEBBLE_PYTHON" - <<PYEOF
import json, os, sys, dbm.dumb

settings_file = '${SETTINGS_FILE}'
platform      = '${PLATFORM}'
project_root  = '${PROJECT_ROOT}'

appinfo_path = os.path.join(project_root, 'build', 'appinfo.json')
if not os.path.exists(appinfo_path):
    print('WARNING: build/appinfo.json not found — run pebble build first', file=sys.stderr)
    sys.exit(0)
with open(appinfo_path) as f:
    uuid = json.load(f)['uuid']

with open(settings_file) as f:
    raw = json.load(f)
settings = {k: v for k, v in raw.items() if v is not None and not k.startswith('_comment')}

try:
    from pebble_tool.sdk import get_sdk_persist_dir
    persist_dir = get_sdk_persist_dir(platform)
except Exception as e:
    print(f'WARNING: could not resolve SDK persist dir: {e}', file=sys.stderr)
    sys.exit(0)

ls_dir = os.path.join(persist_dir, 'localstorage')
os.makedirs(ls_dir, exist_ok=True)
db_path = os.path.join(ls_dir, uuid)

with dbm.dumb.open(db_path, 'c') as db:
    db['clay-settings'] = json.dumps(settings)

print(f'    Wrote {len(settings)} setting(s) to {db_path}')
if not settings:
    print('    (all values were null — clay-settings cleared so defaults apply)')
PYEOF
}

# ---------------------------------------------------------------------------
# Install to emulator (starts QEMU, installs the app, then returns)
#
# Disable set -e for the runtime section — we handle errors explicitly
# from here on (retries, fallback messages, etc.).
# ---------------------------------------------------------------------------
set +e

# Always wipe the emulator state before launching.  The SPI flash written by a
# previous run can leave the firmware in an inconsistent state that causes
# _wait_for_qemu()'s unbounded recv loop to hang forever waiting for the
# "Ready for communication" string.  Wiping forces a fresh flash decompress on
# every launch — identical to a cold start, which always works.
# localstorage is also deleted by wipe, but seed_localstorage() restores it
# at the top of each install attempt before pypkjs is spawned.
echo "==> Wiping emulator state for clean boot..."
pebble wipe 2>/dev/null || true

echo "==> Starting emulator ($PLATFORM) and installing app..."
INSTALL_OK=false
for INSTALL_ATTEMPT in 1 2 3; do
    # Seed localStorage before each attempt — wipe (called on retry) deletes it.
    seed_localstorage
    echo "    install attempt $INSTALL_ATTEMPT of 3..."
    pebble install --emulator "$PLATFORM" --vnc 2>&1
    INSTALL_RC=$?

    if [[ $INSTALL_RC -eq 0 ]]; then
        INSTALL_OK=true
        break
    fi
    # pebble-tool considers the emulator "dead" if pypkjs died, even when
    # QEMU is still running and holding VNC port 5901.  On retry it tries
    # to spawn a new QEMU which fails with "Address already in use".
    # Fix: kill everything between retries so the next attempt starts clean.
    echo "    install attempt $INSTALL_ATTEMPT failed (exit $INSTALL_RC) — cleaning up before retry..."
    pkill -9 -f 'qemu.*pebble' 2>/dev/null || true
    pkill -9 -f pypkjs 2>/dev/null || true
    pkill -9 -f 'websockify.*6080' 2>/dev/null || true
    rm -f /tmp/pb-emulator.json
    pebble wipe 2>/dev/null || true
    sleep 3
done

if [[ "$INSTALL_OK" == "false" ]]; then
    # Check if QEMU ended up running despite non-zero exit code
    if ! pgrep -f 'qemu.*pebble' &>/dev/null; then
        echo "Error: pebble install failed — QEMU did not start after 3 attempts." >&2
        echo "       Make sure DISPLAY is set and an X server is running." >&2
        CLEANUP_EXIT_CODE=1
        exit 1
    fi
    echo "WARNING: pebble install exited $INSTALL_RC but emulator is running — continuing"
fi

# ---------------------------------------------------------------------------
# Serve noVNC viewer via websockify's built-in --web flag.
#
# pebble-tool starts websockify on port 6080 as a bare WebSocket proxy
# (no --web flag).  We kill it and restart with --web so it also serves
# the noVNC HTML/JS files on the same port.  This avoids cross-origin
# issues with ES module imports in VS Code's Simple Browser.
#
# We then update the PID in pb-emulator.json so subsequent pebble
# commands (emu-app-config, logs) still find a live websockify and
# don't try to respawn a bare one.
# ---------------------------------------------------------------------------
NOVNC_WEB="/usr/share/novnc"
if [[ -d "$NOVNC_WEB" ]]; then
    # Wait for QEMU's VNC port to be ready
    echo "==> Waiting for VNC port 5901..."
    for i in $(seq 1 10); do
        if ss -tlnp | grep -q ':5901' 2>/dev/null; then
            break
        fi
        sleep 0.5
    done

    # Also ensure pebble-tool's websockify on 6080 is ready (so we know QEMU is reachable)
    for i in $(seq 1 10); do
        if ss -tlnp | grep -q ':6080' 2>/dev/null; then
            break
        fi
        sleep 0.5
    done

    # Kill pebble-tool's bare websockify and restart with --web
    echo "==> Restarting websockify with --web for noVNC..."
    pkill -f 'websockify.*6080' 2>/dev/null || true
    sleep 1

    "$PEBBLE_PYTHON" -m websockify --heartbeat=30 --web="$NOVNC_WEB" 127.0.0.1:6080 localhost:5901 &>/dev/null &
    WEBSOCKIFY_PID=$!
    sleep 1

    if kill -0 "$WEBSOCKIFY_PID" 2>/dev/null; then
        # Update the PID in pb-emulator.json so pebble-tool finds our websockify
        "$PEBBLE_PYTHON" -c "
import json, os, tempfile
path = os.path.join(tempfile.gettempdir(), 'pb-emulator.json')
with open(path) as f:
    data = json.load(f)
for plat in data.values():
    for ver in plat.values():
        if isinstance(ver, dict) and 'websockify' in ver:
            ver['websockify']['pid'] = $WEBSOCKIFY_PID
with open(path, 'w') as f:
    json.dump(data, f, indent=4)
print('Updated websockify PID to $WEBSOCKIFY_PID')
" 2>&1

        # Build the noVNC viewer URL.
        # VS Code Simple Browser can't handle noVNC's WebSocket + ES modules,
        # so we print the URL for the user to open in an external browser.
        CODESPACE_NAME="${CODESPACE_NAME:-}"
        FWD_DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}"
        if [[ -n "$CODESPACE_NAME" && -n "$FWD_DOMAIN" ]]; then
            # Make port 6080 public so the external URL works
            gh codespace ports visibility 6080:public -c "$CODESPACE_NAME" 2>/dev/null || true
            NOVNC_URL="https://${CODESPACE_NAME}-6080.${FWD_DOMAIN}/vnc_lite.html?autoconnect=true&resize=scale"
        else
            NOVNC_URL="http://localhost:6080/vnc_lite.html?autoconnect=true&resize=scale"
        fi
        echo ""
        echo "============================================================"
        echo "  Pebble emulator display (open in external browser):"
        echo "  $NOVNC_URL"
        echo "============================================================"
        echo ""
    else
        echo "WARNING: websockify with --web failed to start" >&2
    fi
else
    echo "WARNING: noVNC not found at $NOVNC_WEB — emulator display unavailable" >&2
    echo "         Install with: sudo apt-get install -y novnc" >&2
fi

# Give pypkjs a moment to fully initialise the JS runtime.  On first launch
# the emulator+pypkjs may need several seconds before the showConfiguration
# handler is registered.
echo "==> Waiting for JS runtime to initialise..."
sleep 4

# ---------------------------------------------------------------------------
# Open config/settings page  (with retry)
#
# emu-app-config connects to the running emulator over its websocket,
# retrieves the config URL, opens it in $BROWSER, then starts a tiny
# HTTP server that waits for the config-close callback.  It BLOCKS until
# the user submits/closes the settings page, so we run it in the
# foreground.  In a Codespace $BROWSER points at the VS Code helper
# which opens a Simple Browser tab and auto-forwards the port.
#
# pypkjs sometimes isn't ready immediately after install, so we retry
# a few times with increasing delay.
# ---------------------------------------------------------------------------
CONFIG_OK=false
for ATTEMPT in 1 2 3; do
    echo "==> Opening config page (attempt $ATTEMPT of 3)..."
    if pebble emu-app-config --emulator "$PLATFORM" --vnc; then
        CONFIG_OK=true
        break
    fi
    echo "    Config page request timed out — retrying in ${ATTEMPT}s..."
    sleep "$ATTEMPT"
done

if [[ "$CONFIG_OK" == "false" ]]; then
    echo ""
    echo "WARNING: Could not open config page after 3 attempts."
    echo "         The emulator is still running.  You can try manually:"
    echo "           pebble emu-app-config --emulator $PLATFORM --vnc"
    echo ""
fi

# ---------------------------------------------------------------------------
# Tail logs (keeps the script alive until Ctrl+C)
# ---------------------------------------------------------------------------
cat <<INFO

==========================================================
  Rat Scout is running on the $PLATFORM emulator.
${LOCATION_NAME:+
  Location: $GEO_NAME, $GEO_COUNTRY ($GEO_LAT, $GEO_LON)
  Timezone: $TZ
}
  Logs are streaming below.  Press Ctrl+C to stop.
==========================================================
INFO

pebble logs --emulator "$PLATFORM" --vnc
