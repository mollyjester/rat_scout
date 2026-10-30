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
#   install legacy|plugin      install build/<dir>.pbw or build/rat-scout-plugin.pbw
#                              (built here) and capture logs.
#   logs                       capture logs without installing.
#   screenshot                 save a watch screenshot.
#   analyze LOG                summarise a captured log.
#   steps                      print the checklist (operator action + command per step).
#
# Options for install/logs: --seconds N (default 120), --expect direct|pending|plugin|fallback,
#   --name NAME (log file name). All: --out DIR (default build/device-check).
#
# Logs are redacted before they are written: UUIDs other than the app's and email
# addresses are masked. Dexcom IDs and coordinates are never logged by the app
# (dexcom.js, index.js). BG values are not logged by PKJS; the watch's own logs
# may still carry health data, so logs stay under build/ (gitignored).
#
# SAFETY: this talks to the real Dexcom account configured in the app. Never use it
# to try wrong passwords or failing logins (lockout thresholds are UNVERIFIED by decision).

set -u
cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"

TRANSPORT=(--phone)
OUT=build/device-check
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
    LOG="$OUT/${NAME:-$name}-$(date +%Y%m%d-%H%M%S).log"
    echo "==> Capturing ${SECS}s of logs into $LOG"
    timeout "$SECS" pebble "$@" "${TRANSPORT[@]}" 2>&1 | redact > "$LOG"
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
    ('Direct sends', r'Glucose gate: direct send'),
    ('"---" sent', r'No glucose data( \(plugin\))? sent to Pebble successfully'),
    ('Full logins', r'Getting account ID'),
    ('Session logins ok', r'Session ID received'),
    ('Reading fetches', r'Fetching glucose readings'),
    ('Logins skipped', r'Skipping Dexcom login|Dexcom login (paused|in progress)'),
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

# The gate must never let the plugin path resend the last reading. Direct resends are expected.
sends = [(m.group(1), m.group(2)) for l in lines for m in [re.search(r'Glucose gate: (plugin|direct) send ts=(\S+)', l)] if m]
for (s1, t1), (s2, t2) in zip(sends, sends[1:]):
    if s2 == 'plugin' and t2 == t1 and t2 != '0':
        fails.append('plugin path resent ts=%s' % t2)
if span >= 600:
    per5 = count(r'Fetching glucose readings') * 300.0 / span
    print('Reading fetches per 5 min: %.1f' % per5)
if expect:
    final = modes[-1] if modes else None
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
            plugin) python3 -I scripts/pack-plugin.py >/dev/null || { echo "pack-plugin failed" >&2; exit 1; }; pbw=build/rat-scout-plugin.pbw ;;
            legacy) pebble build >/dev/null || { echo "pebble build failed" >&2; exit 1; }; pbw="build/$(basename "$PROJECT_ROOT").pbw" ;;
            *) echo "install legacy|plugin" >&2; exit 2 ;;
        esac
        # The pbw goes before the transport: `--phone` takes an optional value.
        capture "install-$which" install "$pbw" --logs
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

1. Baseline. Operator: plugin preview OFF.          Run: install legacy --expect direct
2. Plugin pbw, preview off. Operator: none.          Run: install plugin --expect direct
3. Preview ON. Operator: Settings -> Plugins -> Plugins / permissions preview; restart the face;
   approve the prompts (Dexcom, OWM, ipgeolocation domains, Location).
                                                     Run: logs --seconds 180 --expect plugin
4. Operator: check the Plugins tab lists Rat Scout and "Read your glucose readings (via Rat Scout)";
   optionally show health/glucose in the Dashboard demo. Run: screenshot
5. Operator: deny the Dexcom domain for Rat Scout.   Run: logs --seconds 180   (expect "---", no login storm)
   Operator: allow it again.                         Run: logs --seconds 180 --expect plugin
6. Operator: turn the preview OFF while the face runs. Run: logs --seconds 1080 (fallback within 11-16 min)
7. Operator: change units in Clay (and the delta toggle). Run: logs --seconds 120; screenshot
8. Wrong password: not on device. Covered by mocked unit tests only (never against real Dexcom).
9. Long run, preview ON.                             Run: logs --seconds 1800 --expect plugin
   (about 6 reading fetches, no plugin resends, no crash)
EOF
        ;;
    *) sed -n '2,/^$/p' "$0"; exit 2 ;;
esac
