#!/usr/bin/env bash
# Emulator smoke test for the plugin preview (manual; not part of the node test loop).
#
# Builds build/rat-scout-plugin.pbw, then runs each case on a freshly wiped
# emulator with seeded localStorage and checks the combined C/PKJS/plugin logs.
#
# SAFETY: every case runs with HTTP(S)_PROXY pointing at a closed local port,
# so no request from PKJS or the plugin can reach Dexcom (pypkjs XHR uses a
# requests.Session, which honours the proxy variables). Credentials are
# obviously fake. Never run this with real Dexcom credentials.
#
# Usage: scripts/plugin-smoke.sh [--platform flint|emery] [--seconds N] [--keep-logs DIR]

set -u
cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"

PLATFORM=flint
SECONDS_PER_CASE=80
LOG_DIR=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --platform) PLATFORM="$2"; shift 2 ;;
        --seconds) SECONDS_PER_CASE="$2"; shift 2 ;;
        --keep-logs) LOG_DIR="$2"; shift 2 ;;
        -h|--help) sed -n 2,13p "$0"; exit 0 ;;
        *) echo "Unknown argument: $1" >&2; exit 2 ;;
    esac
done
[[ -z "$LOG_DIR" ]] && LOG_DIR="$(mktemp -d)"
mkdir -p "$LOG_DIR"

PEBBLE_PY="$(dirname "$(readlink -f "$(command -v pebble)")")/python"
UUID="$(python3 -I -c 'import json; print(json.load(open("package.json"))["pebble"]["uuid"])')"

export HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9
export https_proxy=$HTTPS_PROXY http_proxy=$HTTP_PROXY
export NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1

FAKE_LOGIN='fake-user@example.invalid'
FAKE_PASSWORD='not-a-real-password'

echo "==> Building plugin pbw"
python3 -I scripts/pack-plugin.py >/dev/null || { echo "pack-plugin failed" >&2; exit 1; }

FAILS=0
check() {  # check <log> <description> <grep -E pattern> [absent]
    local log="$1" what="$2" pattern="$3" mode="${4:-present}"
    if grep -Eq "$pattern" "$log"; then found=1; else found=0; fi
    if [[ "$mode" == present && $found == 1 ]] || [[ "$mode" == absent && $found == 0 ]]; then
        echo "  ok   $what"
    else
        echo "  FAIL $what"
        FAILS=$((FAILS + 1))
    fi
}
count() { grep -Ec "$2" "$1" || true; }

seed() {  # seed <json object of localStorage keys>
    "$PEBBLE_PY" -I - "$PLATFORM" "$UUID" "$1" <<'PY'
import dbm.dumb, json, os, sys
from pebble_tool.sdk import get_sdk_persist_dir
platform, uuid, values = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])
d = os.path.join(get_sdk_persist_dir(platform), 'localstorage')
os.makedirs(d, exist_ok=True)
with dbm.dumb.open(os.path.join(d, uuid), 'c') as db:
    for k, v in values.items():
        db[k] = v if isinstance(v, str) else json.dumps(v)
PY
}

run_case() {  # run_case <name> <pbw> <localStorage json>
    local name="$1" pbw="$2" storage="$3" log="$LOG_DIR/$1.log"
    echo "==> Case $name ($PLATFORM, ${SECONDS_PER_CASE}s)"
    pebble kill >/dev/null 2>&1
    pebble wipe >/dev/null 2>&1
    seed "$storage"
    # Screenshot once the first glucose message has had time to arrive.
    (sleep 40; pebble screenshot --no-open --emulator "$PLATFORM" --vnc "$LOG_DIR/$name.png" >/dev/null 2>&1) &
    timeout "$SECONDS_PER_CASE" pebble install --emulator "$PLATFORM" --vnc --logs "$pbw" >"$log" 2>&1
    wait
    pebble kill >/dev/null 2>&1
    LOG="$log"
}

credkey() {
    node -e "console.log(require('./src/common/dexcom_guard').credKey({DEX_LOGIN:process.argv[1],DEX_PASSWORD:process.argv[2],DEX_REGION:'ous'}))" "$FAKE_LOGIN" "$FAKE_PASSWORD"
}

# 1. Plugin pbw, no credentials: plugin answers empty, PKJS in plugin mode shows "---".
run_case empty-credentials build/rat-scout-plugin.pbw '{"clay-settings": {"BG_UNITS": "mg/dL"}}'
check "$LOG" "plugin script ran in the emulator host" "\[Rat Scout\] "
check "$LOG" "PKJS subscribed (mode=pending)" "mode=pending"
check "$LOG" "PKJS switched to mode=plugin" "mode=plugin"
check "$LOG" "plugin ran: no credentials" "No Dexcom credentials"
check "$LOG" "\"---\" sent via the plugin path" "No glucose data \(plugin\) sent to Pebble successfully"
check "$LOG" "no fallback" "mode=fallback" absent
check "$LOG" "no direct Dexcom fetch" "Getting glucose reading" absent

# 2. Fake credentials + a fresh cached reading: served from cache, sent once (gate), no Dexcom call.
NOW=$(date +%s)
CACHE="{\"credKey\":\"$(credkey)\",\"value\":120,\"delta\":5,\"trend\":\"Flat\",\"arrow\":\"→\",\"ts\":$((NOW + 3600))}"
run_case cached-reading build/rat-scout-plugin.pbw "{\"clay-settings\": {\"DEX_LOGIN\": \"$FAKE_LOGIN\", \"DEX_PASSWORD\": \"$FAKE_PASSWORD\", \"DEX_REGION\": \"ous\", \"BG_UNITS\": \"mmol/L\", \"BG_SHOW_DELTA\": true}, \"ratscout.plugin.lastReading\": $CACHE}"
check "$LOG" "mode=plugin" "mode=plugin"
check "$LOG" "BG sent via the plugin path" "BG \(plugin\) sent to Pebble successfully"
check "$LOG" "no Dexcom request (served from cache)" "Getting account ID|Fetching glucose readings" absent
BG_SENDS=$(count "$LOG" "BG \(plugin\) sent to Pebble successfully")
if [[ "$BG_SENDS" == 1 ]]; then echo "  ok   gate: one BG send across host refreshes"; else echo "  FAIL gate: $BG_SENDS BG sends"; FAILS=$((FAILS + 1)); fi
ENVELOPES=$(count "$LOG" "Glucose plugin data: 1 instance")
if [[ "$ENVELOPES" -ge 2 ]]; then echo "  ok   host refreshed the source ($ENVELOPES envelopes)"; else echo "  FAIL only $ENVELOPES envelope(s): gate not exercised"; FAILS=$((FAILS + 1)); fi
echo "  info screenshot: $LOG_DIR/cached-reading.png (expect 6.7)"

# 3. Fake credentials, nothing cached, network blocked: the shim's error path answers "---".
run_case network-blocked build/rat-scout-plugin.pbw "{\"clay-settings\": {\"DEX_LOGIN\": \"$FAKE_LOGIN\", \"DEX_PASSWORD\": \"$FAKE_PASSWORD\", \"DEX_REGION\": \"ous\"}}"
check "$LOG" "plugin tried to log in" "Getting account ID"
check "$LOG" "plugin reported the failure" "Dexcom fetch failed"
check "$LOG" "\"---\" sent via the plugin path" "No glucose data \(plugin\) sent to Pebble successfully"
check "$LOG" "a network failure does not pause logins" "credentials were rejected" absent
ATTEMPTS=$(count "$LOG" "Getting account ID")
MAX_ATTEMPTS=$((SECONDS_PER_CASE / 55 + 1))
if [[ "$ATTEMPTS" -le "$MAX_ATTEMPTS" ]]; then echo "  ok   throttle: $ATTEMPTS login attempts in ${SECONDS_PER_CASE}s (max $MAX_ATTEMPTS)"; else echo "  FAIL throttle: $ATTEMPTS attempts"; FAILS=$((FAILS + 1)); fi

# 4. Legacy pbw (no manifestVersion): the emulator host does not load the plugin; PKJS stays direct.
run_case legacy-pbw "build/$(basename "$PROJECT_ROOT").pbw" '{"clay-settings": {"BG_UNITS": "mg/dL"}}'
check "$LOG" "PKJS in mode=direct" "mode=direct"
check "$LOG" "direct path ran" "Getting glucose reading"
check "$LOG" "no subscription" "mode=pending" absent

echo
echo "Logs: $LOG_DIR"
if [[ $FAILS -gt 0 ]]; then echo "$FAILS check(s) failed"; exit 1; fi
echo "All checks passed"
