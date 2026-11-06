#!/usr/bin/env bash
# Emulator smoke test for the Rat Scout Glucose plugin (manual; not part of the node test loop).
#
# Builds build/rat-scout-glucose.pbw (the plugin) and build/rat-scout.pbw (the watchface),
# then runs each case on a freshly wiped emulator: the plugin's storage is seeded (its
# localStorage, and its secureStorage file for the password), the plugin pbw installed, then
# the watchface installed with logs, and the combined C/PKJS/plugin logs checked.
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
PLUGIN_UUID="$(python3 -I -c 'import json; print(json.load(open("plugin/package.json"))["pebble"]["uuid"])')"

export HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9
export https_proxy=$HTTPS_PROXY http_proxy=$HTTP_PROXY
export NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1

FAKE_LOGIN='fake-user@example.invalid'
FAKE_PASSWORD='not-a-real-password'

echo "==> Building the plugin and watchface pbws"
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

seed() {  # seed <uuid> <json object of localStorage keys> [secureStorage json object]
    "$PEBBLE_PY" -I - "$PLATFORM" "$1" "$2" "${3:-}" <<'PY'
import dbm.dumb, json, os, sys
from pebble_tool.sdk import get_sdk_persist_dir
platform, uuid, values, secure = sys.argv[1], sys.argv[2], json.loads(sys.argv[3]), sys.argv[4]
base = get_sdk_persist_dir(platform)
d = os.path.join(base, 'localstorage')
os.makedirs(d, exist_ok=True)
with dbm.dumb.open(os.path.join(d, uuid), 'c') as db:
    for k, v in values.items():
        db[k] = v if isinstance(v, str) else json.dumps(v)
if secure:
    # pypkjs plugins/js_plugin.py SecureStorage: plain JSON per plugin uuid.
    sd = os.path.join(base, 'plugin-secure-storage')
    os.makedirs(sd, exist_ok=True)
    with open(os.path.join(sd, uuid + '.json'), 'w') as f:
        f.write(secure)
PY
}

run_case() {  # run_case <name> <with plugin: yes|no> <plugin localStorage json> <plugin secure json> <face localStorage json>
    local name="$1" with_plugin="$2" log="$LOG_DIR/$1.log"
    echo "==> Case $name ($PLATFORM, ${SECONDS_PER_CASE}s)"
    pebble kill >/dev/null 2>&1
    pebble wipe >/dev/null 2>&1
    seed "$PLUGIN_UUID" "$3" "$4"
    seed "$UUID" "$5"
    if [[ "$with_plugin" == yes ]]; then
        # The first install after a wipe can race the emulator's boot ("Connection refused"): retry once.
        timeout 60 pebble install --emulator "$PLATFORM" --vnc build/rat-scout-glucose.pbw >"$LOG_DIR/$name.plugin-install.log" 2>&1 ||
            { sleep 5; timeout 60 pebble install --emulator "$PLATFORM" --vnc build/rat-scout-glucose.pbw >>"$LOG_DIR/$name.plugin-install.log" 2>&1; }
        grep -q "App install succeeded" "$LOG_DIR/$name.plugin-install.log" || { echo "  FAIL plugin install (see $name.plugin-install.log)"; FAILS=$((FAILS + 1)); }
    fi
    # Screenshot once the first glucose message has had time to arrive.
    (sleep 40; pebble screenshot --no-open --emulator "$PLATFORM" --vnc "$LOG_DIR/$name.png" >/dev/null 2>&1) &
    timeout "$SECONDS_PER_CASE" pebble install --emulator "$PLATFORM" --vnc --logs build/rat-scout.pbw >"$log" 2>&1
    wait
    pebble kill >/dev/null 2>&1
    LOG="$log"
}

SETTINGS_KEYS="$(node -e "var S=require('./src/plugin-src/settings');console.log(JSON.stringify({login:S.LOGIN_KEY,region:S.REGION_KEY,units:S.UNITS_KEY,password:S.PASSWORD_KEY}))")"
key() { node -e "console.log(JSON.parse(process.argv[1])[process.argv[2]])" "$SETTINGS_KEYS" "$1"; }
ACCOUNT="{\"$(key login)\": \"$FAKE_LOGIN\", \"$(key region)\": \"ous\", \"$(key units)\": \"mmol/L\"}"
SECRET="{\"$(key password)\": \"$FAKE_PASSWORD\"}"
credkey() {
    node -e "console.log(require('./src/plugin-src/dexcom_guard').credKey({DEX_LOGIN:process.argv[1],DEX_REGION:'ous'}))" "$FAKE_LOGIN"
}
NO_DATA="No glucose data sent to Pebble successfully"

# 1. No account on the plugin's settings page: the plugin answers empty, the face shows "---".
run_case no-account yes '{}' '' '{"clay-settings": {"BG_UNITS": "mg/dL"}}'
# Lines logged at the watchface's `ready` can precede the log stream, so no check relies on them.
check "$LOG" "PKJS switched to mode=plugin" "mode=plugin"
check "$LOG" "plugin ran: no account" "No Dexcom account set"
check "$LOG" "\"---\" sent" "$NO_DATA"
check "$LOG" "no Dexcom request" "Getting account ID|Fetching glucose readings" absent

# 2. Account + a fresh cached reading: served from cache, sent once (gate), no Dexcom call.
NOW=$(date +%s)
CACHE="{\"credKey\":\"$(credkey)\",\"value\":120,\"delta\":5,\"trend\":\"Flat\",\"arrow\":\"→\",\"ts\":$((NOW + 3600))}"
PLUGIN_STORE="$(node -e "var o=JSON.parse(process.argv[1]);o['ratscout.plugin.lastReading']=JSON.parse(process.argv[2]);console.log(JSON.stringify(o))" "$ACCOUNT" "$CACHE")"
run_case cached-reading yes "$PLUGIN_STORE" "$SECRET" '{"clay-settings": {"BG_UNITS": "mmol/L", "BG_SHOW_DELTA": true}}'
check "$LOG" "mode=plugin" "mode=plugin"
check "$LOG" "BG sent via the plugin" "BG \(plugin\) sent to Pebble successfully"
check "$LOG" "no Dexcom request (served from cache)" "Getting account ID|Fetching glucose readings" absent
BG_SENDS=$(count "$LOG" "BG \(plugin\) sent to Pebble successfully")
if [[ "$BG_SENDS" == 1 ]]; then echo "  ok   gate: one BG send across host refreshes"; else echo "  FAIL gate: $BG_SENDS BG sends"; FAILS=$((FAILS + 1)); fi
ENVELOPES=$(count "$LOG" "Glucose plugin data: 1 instance")
if [[ "$ENVELOPES" -ge 2 ]]; then echo "  ok   host refreshed the source ($ENVELOPES envelopes)"; else echo "  FAIL only $ENVELOPES envelope(s): gate not exercised"; FAILS=$((FAILS + 1)); fi
echo "  info screenshot: $LOG_DIR/cached-reading.png (expect 6.7)"

# 3. Account (password from secureStorage), nothing cached, network blocked: "---", no pause.
run_case network-blocked yes "$ACCOUNT" "$SECRET" '{"clay-settings": {"BG_UNITS": "mg/dL"}}'
check "$LOG" "plugin tried to log in (password read from secureStorage)" "Getting account ID"
check "$LOG" "plugin reported the failure" "Dexcom fetch failed"
check "$LOG" "\"---\" sent" "$NO_DATA"
check "$LOG" "a network failure does not pause logins" "credentials were rejected" absent
ATTEMPTS=$(count "$LOG" "Getting account ID")
MAX_ATTEMPTS=$((SECONDS_PER_CASE / 55 + 1))
if [[ "$ATTEMPTS" -le "$MAX_ATTEMPTS" ]]; then echo "  ok   throttle: $ATTEMPTS login attempts in ${SECONDS_PER_CASE}s (max $MAX_ATTEMPTS)"; else echo "  FAIL throttle: $ATTEMPTS attempts"; FAILS=$((FAILS + 1)); fi

# 4. Watchface without the plugin installed: unavailable, "---", no subscription, no Dexcom.
run_case no-plugin no '{}' '' '{"clay-settings": {"BG_UNITS": "mg/dL"}}'
check "$LOG" "\"---\" sent" "$NO_DATA"
check "$LOG" "no subscription" "mode=pending|mode=plugin|Glucose plugin data" absent
check "$LOG" "no Dexcom request from the watchface" "Getting account ID|Fetching glucose readings" absent

echo
echo "Logs: $LOG_DIR"
if [[ $FAILS -gt 0 ]]; then echo "$FAILS check(s) failed"; exit 1; fi
echo "All checks passed"
