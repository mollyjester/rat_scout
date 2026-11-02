#!/usr/bin/env bash
# device-check.sh — Run the plugin on-device checklist against a real phone and
# read the combined watch (C), PKJS and plugin logs.
#
# Transport (pebble-tool 5.1.1, pebble_tool/commands/base.py):
#   --cloudpebble       default; the CloudPebble proxy (`pebble --phone` with no
#                       IP). Needs `pebble login` (see the login/callback commands).
#   --phone-ip IP[:PORT] the Pebble app's developer connection directly (port 9000).
#   --adb               Android over adb (adb must be installed and see the phone);
#   --adb-serial SERIAL picks one of several devices.
#
# Commands:
#   login                      pebble login --no-open-browser: prints a sign-in URL
#                              and waits for the browser callback on localhost:60000.
#   callback URL               deliver the http://localhost:60000/?... address the
#                              browser could not open (when pebble-tool runs in a
#                              container the browser can't reach).
#   install face|glucose       install the watchface (build/rat-scout.pbw) or the Rat Scout
#                              Glucose plugin (build/rat-scout-glucose.pbw), both built here,
#                              and capture logs. Install the plugin before the face.
#   logs                       capture logs without installing.
#   screenshot                 save a watch screenshot.
#   analyze LOG                summarise a captured log.
#   steps                      print the checklist (operator action + command per step).
#
# Options for install/logs: --seconds N (default 120), --expect unavailable|pending|plugin,
#   --name NAME (log file name). All: --out DIR (default .device-check, gitignored; not under build/, which pack-plugin.py cleans).
#
# Logs are redacted before they are written: UUIDs other than the app's and email
# addresses are masked. Dexcom IDs and coordinates are never logged by the app
# (dexcom.js, index.js). BG values are not logged by PKJS; the watch's own logs
# may still carry health data, so logs stay in .device-check/ (gitignored).
#
# SAFETY: this talks to the real Dexcom account configured in the app. Never use it
# to try wrong passwords or failing logins (lockout thresholds are UNVERIFIED by decision).

set -u
cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"

TRANSPORT=(--phone)
OUT=.device-check
SECS=120
EXPECT=""
NAME=""
CMD=""
ARGS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --cloudpebble) TRANSPORT=(--phone); shift ;;
        --phone-ip) TRANSPORT=(--phone "$2"); shift 2 ;;
        --adb) TRANSPORT=(--adb); shift ;;
        --adb-serial) TRANSPORT=(--adb "$2"); shift 2 ;;
        --seconds) SECS="$2"; shift 2 ;;
        --expect) EXPECT="$2"; shift 2 ;;
        --name) NAME="$2"; shift 2 ;;
        --out) OUT="$2"; shift 2 ;;
        -h|--help) sed -n '2,/^$/p' "$0"; exit 0 ;;
        *) if [[ -z "$CMD" ]]; then CMD="$1"; else ARGS+=("$1"); fi; shift ;;
    esac
done
mkdir -p "$OUT"

UUID="$(python3 -I -c 'import json; print(json.load(open("package.json"))["pebble"]["uuid"])')"

redact() {  # stdin -> stdout
    sed -u -E \
        -e "s/$UUID/__APP_UUID__/g" \
        -e 's/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/<uuid>/g' \
        -e 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/<email>/g' \
        -e "s/__APP_UUID__/$UUID/g"
}

capture() {  # capture <name> <pebble args...>; sets LOG
    local name="$1"; shift
    mkdir -p "$OUT"
    LOG="$OUT/${NAME:-$name}-$(date +%Y%m%d-%H%M%S).log"
    echo "==> Capturing ${SECS}s of logs into $LOG"
    # Run outside the project: pebble-tool 5.1.1/5.1.2 registers its log handlers before
    # loading build/pebble-js-app.js.map (util/logs.py PebbleLogPrinter.__init__), and a
    # PKJS log arriving meanwhile crashes it. With no sourcemap the window is tiny.
    local here; here="$(pwd)"; LOG="$here/$LOG"
    (cd "$(mktemp -d)" && timeout "$SECS" pebble "$@" "${TRANSPORT[@]}") 2>&1 | redact > "$LOG"
    echo "==> Captured $(wc -l < "$LOG") lines"
}

analyze() {  # analyze <log> [expect]
    python3 -I - "$1" "${2:-}" <<'PY'
import re, sys
path, expect = sys.argv[1], sys.argv[2]
lines = open(path, encoding='utf-8', errors='replace').read().splitlines()
fails = []

def times():
    ts = [l[1:9] for l in lines if re.match(r'^\[\d\d:\d\d:\d\d\]', l)]
    if len(ts) < 2: return 0
    def s(t): h, m, x = map(int, t.split(':')); return h * 3600 + m * 60 + x
    d = s(ts[-1]) - s(ts[0])
    return d + 86400 if d < 0 else d

def count(pattern): return sum(1 for l in lines if re.search(pattern, l))

modes = [m.group(1) for l in lines for m in [re.search(r'Glucose source: mode=(\w+)', l)] if m]
span = times()
print('Log: %s (%d lines, %d s)' % (path, len(lines), span))
print('Modes seen:        %s' % (' -> '.join(modes) or 'none'))
stats = [
    ('Plugin envelopes', r'Glucose plugin data: '),
    ('Plugin sends', r'Glucose gate: plugin send'),
    ('Duplicates skipped', r'Glucose gate: skipped duplicate'),
    ('"---" sent', r'No glucose data( \(plugin\))? sent to Pebble successfully'),
    ('Full logins', r'Getting account ID'),
    ('Session logins ok', r'Session ID received'),
    ('Reading fetches', r'Fetching glucose readings'),
    ('Logins skipped', r'Skipping Dexcom login|Dexcom login (paused|in progress)'),
    ('Resubscribes', r'Glucose plugin: resubscribe'),
]
for label, pat in stats:
    print('%-18s %d' % (label + ':', count(pat)))
errors = sorted(set(m.group(1) for l in lines for m in [re.search(r'Glucose plugin error: (\w+)', l)] if m))
print('Plugin error codes: %s' % (', '.join(errors) or 'none'))
for label, pat in [('Permission', r'(?i)permission|NotAllowedError'), ('Crash', r'(App|Worker) fault'),
                   ('Send errors', r'Error sending |Message dropped|Outbox send failed')]:
    hits = [l for l in lines if re.search(pat, l)]
    if hits:
        print('%s lines (%d):' % (label, len(hits)))
        for l in hits[:5]: print('    ' + l)
if count(r'(App|Worker) fault'): fails.append('watch app crashed')
nodata = count(r'No glucose data( \(plugin\))? sent to Pebble successfully')
if nodata and nodata == count(r'Glucose gate: plugin send'):
    print('WARN every glucose send was "---" (no reading from Dexcom, or a failure: check the log)')

# The gate must never resend the last reading, except right after the settings page closed
# (onSettingsChanged clears the gate on purpose so new units/delta apply).
last = None
for l in lines:
    if 'Settings form closed' in l:
        last = None
        continue
    m = re.search(r'Glucose gate: plugin send ts=(\S+)', l)
    if not m:
        continue
    if m.group(1) == last and last != '0':
        fails.append('resent ts=%s' % last)
    last = m.group(1)
if span >= 600:
    per5 = count(r'Fetching glucose readings') * 300.0 / span
    print('Reading fetches per 5 min: %.1f' % per5)

# Delay from Dexcom reading time to the send, per new reading. Log times are HH:MM:SS of the
# capturing machine, read as UTC (as in this container); the reading ts is epoch seconds.
sends = []
for l in lines:
    m = re.match(r'^\[(\d\d):(\d\d):(\d\d)\].*Glucose gate: plugin send ts=(\d+)', l)
    if m and m.group(4) != '0' and (not sends or sends[-1][1] != int(m.group(4))):
        sends.append((int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)), int(m.group(4))))
if sends:
    print('New readings sent (reading UTC -> sent, delay):')
    skipped = 0
    for i, (at, ts) in enumerate(sends):
        delay = (at - ts % 86400) % 86400
        r = ts % 86400
        print('    %02d:%02d:%02d -> %02d:%02d:%02d  %d s' % (r // 3600, r // 60 % 60, r % 60, at // 3600, at // 60 % 60, at % 60, delay))
        if i:
            skipped += max(0, int(round((ts - sends[i - 1][1]) / 300.0)) - 1)
    print('Readings skipped between sends: %d' % skipped)
    print('Reading fetches per new reading: %.1f' % (count(r'Fetching glucose readings') / float(len(sends))))
if expect:
    final = modes[-1] if modes else None
    # Already in plugin mode before the capture: no mode line, but plugin envelopes arrive.
    if final is None and count(r'Glucose plugin data: ') > 0:
        final = 'plugin'
    if final != expect: fails.append('final mode %s, expected %s' % (final, expect))
if fails:
    for f in fails: print('FAIL ' + f)
    sys.exit(1)
print('ok' + (' (final mode %s)' % expect if expect else ''))
PY
}

case "$CMD" in
    login)
        PYTHONUNBUFFERED=1 exec pebble login --no-open-browser ;;
    callback)
        url="${ARGS[0]:-}"
        [[ "$url" =~ ^http://localhost:60000/ ]] || { echo "Expected the http://localhost:60000/?... address from the browser" >&2; exit 2; }
        curl -s -o /dev/null -w 'callback delivered (HTTP %{http_code})\n' "$url" ;;
    install)
        which="${ARGS[0]:-}"
        case "$which" in
            face) python3 -I scripts/pack-plugin.py >/dev/null || { echo "pack-plugin failed" >&2; exit 1; }; pbw=build/rat-scout.pbw ;;
            glucose) python3 -I scripts/pack-plugin.py >/dev/null || { echo "pack-plugin failed" >&2; exit 1; }; pbw=build/rat-scout-glucose.pbw ;;
            *) echo "install face|glucose" >&2; exit 2 ;;
        esac
        # The pbw goes before the transport: `--phone` takes an optional value.
        capture "install-$which" install "$PROJECT_ROOT/$pbw" --logs
        analyze "$LOG" "$EXPECT" ;;
    logs)
        capture logs logs
        analyze "$LOG" "$EXPECT" ;;
    screenshot)
        f="$OUT/${NAME:-screenshot}-$(date +%Y%m%d-%H%M%S).png"
        pebble screenshot --no-open "$f" "${TRANSPORT[@]}" && echo "$f" ;;
    analyze)
        analyze "${ARGS[0]:?log file}" "$EXPECT" ;;
    steps)
        cat <<'EOF'
On-device checklist (Pebble app 1.16.x). "Operator" = done on the phone; "Run" = this script.
Start a session first: login, open the printed URL, paste the failed localhost:60000 address to `callback`.

1. Plugin. Operator: plugin preview ON.              Run: install glucose
   Operator: Apps -> Plugins -> Rat Scout Glucose -> Settings: enter the Dexcom account, Save.
   Check its page lists only the three Dexcom domains.
2. Watchface.                                         Run: install face --expect plugin --seconds 180
   Operator: approve "Read your glucose readings (via Rat Scout Glucose)" if asked.
   Check the face's page lists weather, location and that glucose permission, no Dexcom domains.
3. Preview OFF while the face runs.                   Run: logs --seconds 900 --expect unavailable
   ("---" after a PLUGIN_UNAVAILABLE error, or at the latest when the 11 min stall watchdog fires)
   Preview ON again.                                  Run: logs --seconds 360 --expect plugin (re-check)
4. Operator: change units/delta in Rat Scout's Clay settings. Run: logs --seconds 120; screenshot
5. Operator: switch units on the plugin's settings page. Run: logs --seconds 120 (the face's display
   units come from Clay; the plugin's units only change its own glucose/delta shapes)
6. Wrong password: not on device. Covered by mocked unit tests only (never against real Dexcom).
7. Long run, preview ON.                             Run: logs --seconds 1800 --expect plugin
   (about 6 new readings, each sent once within about 1-2 min, none skipped,
    about 1-2 reading fetches per new reading, no plugin resends, no crash)
EOF
        ;;
    *) sed -n '2,/^$/p' "$0"; exit 2 ;;
esac
