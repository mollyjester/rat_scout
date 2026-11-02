# Rat Scout — Dexcom CGM Watchface for Pebble

A feature-rich Pebble watchface that displays Dexcom continuous glucose monitoring (CGM) data alongside weather, astronomy, and daily life information.

https://apps.rePebble.com/bfecfeaed9de40ef9d929b66

## Overview

Rat Scout displays real-time Dexcom Share blood glucose readings on your Pebble smartwatch. The readings come from **Rat Scout Glucose**, a companion phone-side plugin (a separate pbw) that talks to Dexcom; the watchface itself never contacts Dexcom. In addition to glucose tracking, it shows current time, date, week number, weather conditions (temperature, wind speed, umbrella indicator), sunrise/sunset and moonrise/moonset times, moon phase, step count, garbage collection schedule, and battery status — all on a single watchface.

## Features

### Glucose Monitoring
- **Real-time glucose display** with automatic 5-minute update cycle
- **Glucose delta**: rate of change (±) from previous reading
- **Time since reading**: minutes elapsed since last CGM data
- **Configurable units**: mg/dL or mmol/L
- **Threshold vibration alerts**: distinct vibration patterns for high and low BG
  - High: short-long pattern
  - Low: long-short pattern
  - One-shot: vibrates only on zone transition, not repeatedly
  - **Night thresholds**: optional separate thresholds during a configurable night window
- **Threshold sound alerts**: short melody when entering the low or high BG zone (Emery and Flint speaker)
  - Low: descending B minor arpeggio (F#4–D4–B3), played twice, triangle wave
  - High: the same arpeggio ascending (B3–D4–F#4)
  - Each toggle is independent of vibration; sounds can be enabled, disabled, and previewed separately
- **Multi-region Dexcom**: US, Outside-US (OUS), and Japan servers (set in the plugin)

### Weather (OpenWeatherMap)
- **Temperature & wind speed** in metric or imperial units
- **Umbrella indicator**: highlights when rain/snow is expected today (current conditions + 5-day forecast)
- **Smart caching**: configurable interval (30 min – 3 hours) with location-aware cache invalidation (>5 km change)

### Astronomy (ipgeolocation.io)
- **Sunrise/Sunset**: shows the next upcoming event; after sunset shows tomorrow's sunrise
- **Moonrise/Moonset**: handles both normal and inverted moon event ordering
- **Moon phase icon**: 8 phases (new → waxing crescent → … → waning crescent)
- **Daily cache**: fetched once per day, refreshes at midnight

### Time & Date
- **Time**: 12/24-hour format (follows system setting)
- **Date**: day.month format
- **Week number**: ISO week with "W" prefix
- **Weekday**: 3-letter abbreviation in status bar

### Status Bar
- **Hourly vibration indicator**: shows when hourly chime is enabled
- **Umbrella indicator**: highlights when rain is expected
- **Garbage collection**: underscores the next bag type (Organic / Grey / Black) based on weekly schedule, rolls over at 9 AM
### Quick View Alerts
- **Transient overlay banner**: appears at the bottom of the watchface after a BG threshold or hourly vibration fires
- **Icon-coded**: distinct icons for high/low BG alerts vs. hourly chime
- **Configurable duration**: Short (3 s), Normal (10 s), or Long (20 s)
- **Auto-dismiss**: overlay disappears after the chosen duration without interaction
- **Enable/disable**: can be toggled independently of vibration alerts
### Other
- **Battery indicator**: visual bar with charging animation
- **Step count**: daily steps from Pebble Health (on supported platforms)
- **Persistent state**: data persists across app restarts
- **Platforms**: Emery (Pebble Time 2) and Flint (Pebble 2 Duo)

### Plugin (preview)
Rat Scout ships as two pbws (see [Plugin pbws](#plugin-pbws-preview-sideload-only)):

- **Rat Scout Glucose** (`build/rat-scout-glucose.pbw`): a plugin-only pbw that serves the latest Dexcom reading as `health/glucose` (glucose in its own units and in mg/dL, delta, trend arrow and reading time), so Rat Scout, other watchfaces, apps and Index can show it. It holds the Dexcom account, set on its own settings page.
- **Rat Scout** (`build/rat-scout.pbw`): the watchface. It reads glucose only from the plugin; without it (not installed, preview off, permission not granted, or failing) the watch shows "---". There is no direct-Dexcom fallback.

Both need the **Pebble mobile app 1.16.x with the plugin preview enabled** (**Settings → Plugins → Plugins / permissions preview**; off by default). The legacy `pebble build` pbw (`build/<dir>.pbw`) can't read plugins.

The plugin calls Dexcom at most once every 55 s, reuses a reading until the next one is due (5 minutes), and pauses logins for 15 minutes if Dexcom refuses the password (an hour if Dexcom reports too many attempts), until you change the credentials. It keeps its Dexcom session when Dexcom just has no new reading, so it doesn't log in again on every poll. Design details: [.github/ARCHITECTURE.md](.github/ARCHITECTURE.md#plugin-preview--healthglucose).

> **Sideload only — do not publish.** Plugins are an unstable preview. Never publish either pbw to the appstore (no `pebble publish`); install them only by sideloading.

## Requirements

- **Pebble 2 Duo or Pebble Time 2 smartwatch**
- **Dexcom Share account** with a connected CGM transmitter
- **Pebble app 1.16.x** on your phone with the plugin preview enabled (glucose comes from the Rat Scout Glucose plugin)
- **Internet connection** on phone for API access

## Setup

1. In the Pebble app, turn on **Settings → Plugins → Plugins / permissions preview**.
2. Sideload both pbws, the plugin first: `build/rat-scout-glucose.pbw`, then `build/rat-scout.pbw` (see [Plugin pbws](#plugin-pbws-preview-sideload-only)).
3. Open **Apps → Plugins → Rat Scout Glucose → Settings**, enter the Dexcom login, password, region and units, and Save. Its page asks only for Internet access to the three Dexcom domains.
4. Approve "Read your glucose readings (via Rat Scout Glucose)" when the Pebble app asks on Rat Scout's behalf. Until then the face shows "---".

## Configuration

### Rat Scout Glucose (plugin settings page)
| Setting | Description |
|---------|-------------|
| Dexcom login | Dexcom Share account email/username |
| Dexcom password | Stored in the plugin's `Pebble.secureStorage`; never shown again ("Saved (leave empty to keep)") |
| Region | Dexcom server: Outside US (default), US, or Japan |
| Units | mg/dL or mmol/L, for the plugin's own `glucose`/`delta` values (Rat Scout's display uses its own BG Units) |

Saving drops the plugin's Dexcom session and throttle and asks the phone to refresh `health/glucose`, so the new account is tried at once.

### Rat Scout (Clay settings)
Open Rat Scout settings from the Pebble app on your phone. It has no Dexcom fields; the "Glucose" section points to the plugin's settings page.

### Display
| Setting | Description |
|---------|-------------|
| BG Units | mg/dL or mmol/L |
| Show BG Delta | Toggle glucose rate of change |
| Show Time Delta | Toggle time since last reading |
| Date Format | dd.mm or mm.dd |

### Notifications
| Setting | Description |
|---------|-------------|
| Hourly Vibration | Double-pulse every hour on the hour |
| Hourly Sound | Two short C6 tones (125 ms each) every hour on the hour |
| BG Threshold Vibration | Enable/disable glucose threshold alerts |
| Low BG Threshold | Alert threshold in your preferred units |
| High BG Threshold | Alert threshold in your preferred units |
| Low Threshold Sound | Play descending alert melody when BG drops into the low zone |
| High Threshold Sound | Play ascending alert melody when BG rises into the high zone |
| Night Low Threshold | Optional low threshold during the night window |
| Night High Threshold | Optional high threshold during the night window |
| Night Start | Hour when night thresholds activate (0-23) |
| Night End | Hour when night thresholds deactivate (0-23) |
| Quick View Alerts | Show transient overlay banner after BG or hourly alerts |
| Alert Duration | Duration the overlay banner stays on screen: Short (3 s), Normal (10 s), Long (20 s) |

Night thresholds allow you to use different alerting ranges while you sleep (e.g., wider range to avoid unnecessary vibrations). If the night threshold fields are left empty or no night time frame is set, the general thresholds are used around the clock. The night window supports crossing midnight (e.g., start=22, end=7).

### Astronomy (Optional)
| Setting | Description |
|---------|-------------|
| API Key | ipgeolocation.io API key ([free signup](https://ipgeolocation.io/)) |

### Weather (Optional)
| Setting | Description |
|---------|-------------|
| API Key | OpenWeatherMap API key ([free signup](https://openweathermap.org/api)) |
| Units | Metric (°C, m/s) or Imperial (°F, mph) |
| Update Interval | 30 min, 1 hour, 2 hours, or 3 hours |

### Garbage Collection
| Setting | Description |
|---------|-------------|
| Pickup Time | Hour of day after which the next bag is shown (default 9) |
| Organic / Grey / Black Days | Weekdays each bag type is collected |

Every settings key, its default and its fallback: [scripts/settings.md](scripts/settings.md).

All settings are stored locally on your phone, separately per pbw: Rat Scout's in its `clay-settings`, the plugin's in its own storage. On start, Rat Scout deletes the Dexcom login, password and region and the Dexcom session keys that older versions left in its storage (`src/pkjs/legacy_cleanup.js`).

## Architecture

Main files (the full layout is in [.github/ARCHITECTURE.md](.github/ARCHITECTURE.md#repository-layout)):

```
src/
├── c/
│   ├── rat_scout.c          # Watchface core: UI, layer setup, vibration, persistent storage
│   ├── overlay.c            # Transient overlay notification banner (Quick View Alerts)
│   ├── glucose.c            # Glucose update rendering and BG threshold alert logic
│   ├── sounds.c             # Alert melodies (low/high BG, hourly chime)
│   ├── messaging.c          # AppMessage handler: settings ingestion, data dispatch
│   ├── draw_procs.c         # Custom GPath and drawing procedures
│   ├── layout.c             # Layer positioning and watchface layout
│   └── ui_helpers.c         # Shared UI utility functions
├── plugin-src/               # Rat Scout Glucose sources, bundled into plugin/plugin.js
│   ├── main.js               # health/glucose source handler, cache, throttle, settings-page handler
│   ├── settings.js           # Plugin settings: localStorage + secureStorage (password)
│   ├── dexcom.js             # Dexcom Share API client (auth + glucose readings)
│   ├── dexcom_guard.js       # Dexcom login guard
│   └── xhr_shim.js           # XMLHttpRequest subset on fetch
└── pkjs/
    ├── index.js              # App orchestrator: settings, data fetching, message queue
    ├── glucose.js            # BG/delta formatting (also bundled into the plugin)
    ├── glucose_plugin.js     # Subscribes to the plugin; unavailable/pending/plugin modes
    ├── legacy_cleanup.js     # Purges Dexcom data older versions stored in the face
    ├── weather.js            # OpenWeatherMap 2.5 API (current + forecast)
    ├── geolocation.js        # ipgeolocation.io astronomy API client
    ├── astronomy.js          # Astronomy time calculations (next sun/moon event logic)
    ├── garbage.js            # Garbage bag schedule
    ├── clay-config.js        # Clay test-button handlers
    └── config.json           # Clay settings UI definition
plugin/                       # The Rat Scout Glucose pbw (plugin-only)
├── package.json              # Its manifest: own uuid, Dexcom domains, plugin block, configPage
├── plugin.js                 # GENERATED bundle (node scripts/build-plugin.js); never edit
└── config.html               # Its settings page (Dexcom account, units)
```

### Data Flow

```
Rat Scout Glucose plugin ─→ Dexcom Share API ─→ health/glucose envelope ─┐
Phone JS (face) ─→ subscription to the plugin ─→ glucose dictionary  ←───┘ ─┐
                ─→ ipgeolocation.io ─→ Astronomy data (cached daily)          ─┤
                ─→ OpenWeatherMap   ─→ Weather data (cached per interval)     ─┤
                                                                               ├─→ Message Queue ─→ Pebble Watch
                                                            Settings ──────────┘
```

PKJS subscribes to the Rat Scout Glucose plugin (`health/glucose`) and shows "---" (mode `unavailable`) when the plugin API is absent, the plugin isn't listed, the permission is denied, the plugin fails, sends nothing within 30 s of subscribing, or is silent for more than 11 minutes. One transient error keeps the shown reading; a second leads to "---". While unavailable without a subscription it checks for the plugin again on every watch request (at least every 5 minutes), so installing the plugin or turning the preview on while the face runs switches to it without restarting the face. When a reading is overdue (more than 5 minutes old) and the plugin has been quiet for about a minute, a watch request resubscribes, which makes the phone run the plugin at once instead of at its next poll (the phone's 60 s poll counts only time the phone is awake and was seen to take about 6 minutes). It does this at most about once a minute, and the plugin's cache and throttle still allow at most one Dexcom call per 55 s (`src/pkjs/glucose_plugin.js`; modes and triggers in [.github/ARCHITECTURE.md](.github/ARCHITECTURE.md#glucose-source-selection-srcpkjsglucose_pluginjs)). How a manifestVersion 2 pbw behaves on phone apps older than 1.16 is UNVERIFIED.

Glucose, weather and astronomy data are sent as separate messages. A message queue ensures only one `sendAppMessage` call is in flight at a time.

### Watchface Layout

![Watchface Layout](resources/img/rat_scout.png)

## Development

### Dev Container

`.devcontainer/` provides everything needed on a fresh machine: Ubuntu 24.04 (the emulator needs glibc ≥ 2.38), Node.js, the emulator's runtime libraries, Xvfb/noVNC, `uv` and `pebble-tool`. On first start, `.devcontainer/setup.sh` downloads the latest Pebble SDK and runs `npm ci`; it is idempotent and can be re-run manually.

Outside the dev container, follow the [official SDK install guide](https://developer.repebble.com/sdk/) (`uv tool install pebble-tool`, `pebble sdk install latest`), then `npm ci`.

### Running in Emulator (Codespace / Local)

```bash
# Default (flint platform):
./scripts/run-emulator.sh

# Clean build first, specific platform, pre-seeded settings:
./scripts/run-emulator.sh --build --platform emery --settings scripts/settings.json

# Install the plugin-aware watchface instead of the legacy project build
# (install build/rat-scout-glucose.pbw with `pebble install --emulator` for glucose):
python3 -I scripts/pack-plugin.py && ./scripts/run-emulator.sh --pbw build/rat-scout.pbw

# See all options:
./scripts/run-emulator.sh --help
```

### Plugin smoke test (emulator)

```bash
./scripts/plugin-smoke.sh [--platform flint|emery] [--seconds N] [--keep-logs DIR]
```

Manual; not part of the test loop. Builds both pbws and runs four cases on a freshly wiped emulator (`--seconds`, default 80 s each). Each case seeds the plugin's localStorage and its secureStorage file (`plugin-secure-storage/<plugin uuid>.json`, for the password), installs the plugin pbw, then installs the face pbw with logs and checks them: no account (plugin mode, "---"), a fake account with a seeded cached reading (served from cache, sent once, screenshot saved; on flint it shows 6.7 +0.3), a fake account with no cache (login fails, "---", throttled), and no plugin installed (unavailable, "---", no subscription, no Dexcom request). Lines the face logs at `ready` can precede the log stream, so no check relies on them. Every case runs with `HTTP(S)_PROXY` set to a closed local port and obviously fake credentials, so nothing reaches Dexcom. **Never try wrong passwords or failing logins against the real Dexcom service** (emulator or phone): Dexcom's lockout thresholds are UNVERIFIED and stay that way by decision. Login failures are tested only with a mocked fetch (`test/dexcom_guard.test.js`, `test/plugin.test.js`).

For developing plugins with the current app, SDK and tools (versions, the Android sandbox, packaging, testing, pitfalls), see [docs/plugins.md](docs/plugins.md).

### Plugin check on a real phone

```bash
./scripts/device-check.sh steps                       # the checklist: operator action + command per step
./scripts/device-check.sh login                       # prints a sign-in URL, waits for the callback
./scripts/device-check.sh callback 'http://localhost:60000/?...'
./scripts/device-check.sh install glucose               # the plugin pbw first
./scripts/device-check.sh install face --expect plugin [--seconds N]
./scripts/device-check.sh logs --seconds 1800 --expect plugin
./scripts/device-check.sh screenshot
```

Needs the Pebble mobile app 1.16.x with the plugin preview enabled. `install face|glucose` builds both pbws (`pack-plugin.py`) and installs `build/rat-scout.pbw` or `build/rat-scout-glucose.pbw`. Each command installs or captures logs for `--seconds` (default 120), running pebble from an empty temporary directory (pebble-tool 5.1.1/5.1.2 can crash on a PKJS log that arrives while it loads the project's sourcemap), then summarises the watch (C), `pkjs>` and `plugin>` log lines: the glucose modes seen, plugin envelopes, gate sends, duplicates the gate skipped, Dexcom logins and reading fetches, plugin error codes, permission and crash lines. It fails on a crash, on the plugin path resending the last reading, or when the final mode differs from `--expect`.

- **Transport:** the CloudPebble proxy by default (`pebble --phone` with no IP), which works when this machine can't reach the phone. It needs `pebble login`. In a container your browser can't reach, run `login`, open the URL, then paste the `http://localhost:60000/?...` address the browser fails to load into `callback`. With a reachable phone use `--phone-ip IP`; on Android over USB use `--adb`.
- **Privacy:** logs are written to `.device-check/` (gitignored; not under `build/`, which the plugin packer cleans), with UUIDs other than the app's and email addresses masked. The app never logs Dexcom account or session IDs or device coordinates.
- **Safety:** this uses the real Dexcom account set on the plugin's settings page. The wrong-password step stays off-device (mocked unit tests only).

See [docs/noVNC.md](docs/noVNC.md) for viewing the emulator in a browser, stopping it, seeding Clay settings, fixing the location and taking screenshots.

The script streams logs from both sides once the app is running: lines prefixed `pkjs>` come from PebbleKit JS `console.log`, and lines prefixed `<file>.c:<line>>` come from C `APP_LOG`.

### Emulator Commands (headless)

In a container without a display, add `--vnc` to every command that uses `--emulator`:

```bash
pebble install --emulator flint --vnc                                  # start emulator + install
pebble screenshot --no-open --emulator flint --vnc screenshot.png      # save the screen as PNG
pebble logs --emulator flint --vnc                                     # stream C + JS logs
pebble emu-button click select --emulator flint --vnc                  # press a button
pebble kill && pebble wipe                                             # reset a stuck emulator
```

## Building

Requires Pebble SDK 4.x (tested with SDK 4.33.1 / pebble-tool 5.1.1 on Python 3.13). Settings UI uses [`@rebble/clay`](https://github.com/pebble-dev/clay), the maintained Clay fork with flint/emery support.

```bash
npm ci
pebble build
for f in test/*.test.js; do node "$f" || exit 1; done
```

The legacy `pebble build` pbw can't read plugins, so it always shows "---" for glucose; install the two pbws below instead.

### Plugin pbws (preview, sideload only)

`pebble build` produces a **legacy** watchface pbw (`build/work.pbw`, named after the checkout directory): SDK 4.33.1 has no plugin support, so the pbw has no `manifestVersion` and can't read plugins. To build the two pbws:

```bash
node scripts/build-plugin.js           # after editing src/plugin-src/ or src/pkjs/glucose.js
node scripts/build-plugin.js --check   # exit 1 if plugin/plugin.js is stale
python3 -I scripts/pack-plugin.py      # clean build + build/rat-scout.pbw and build/rat-scout-glucose.pbw
python3 -I scripts/pack-plugin.py --selftest   # packer self test on in-memory pbws
pebble install --phone <phone_ip> build/rat-scout-glucose.pbw   # the plugin first
pebble install --phone <phone_ip> build/rat-scout.pbw
```

- `build/rat-scout.pbw`: the `pebble build` output with `manifestVersion: 2` (a watchapp needs it to read plugins), no plugin.
- `build/rat-scout-glucose.pbw`: plugin-only, built from `plugin/` without the SDK: `appinfo.json` (from `plugin/package.json`), `plugin.js` and `config.html`.

`pack-plugin.py` refuses to run if `plugin/plugin.js` is stale, validates `definesPermissions`, and copies the watchface pbw unchanged once a future SDK sets `manifestVersion` itself; `--no-build` packs the existing build output. SDK 4.33.1 was the newest on the SDK server on 2026-10-30. The results are for sideloading only (see [Plugin (preview)](#plugin-preview)).

pebble-tool 5.1.1 runs `waf` with the SDK's own venv but passes its own `sys.path` as `PYTHONPATH` (`pebble_tool/commands/sdk/project/__init__.py`), so pebble-tool and the SDK venv must use the same Python minor version; otherwise `pebble build` fails with `SRE module mismatch`. Reinstall with `uv tool install --force --python <the SDK venv's python> pebble-tool==5.1.1`.

## Credits

- Dexcom API approach inspired by [pydexcom](https://github.com/gagebenne/pydexcom)
- Settings UI powered by [Pebble Clay](https://github.com/pebble/clay)
- Astronomy data by [ipgeolocation.io](https://ipgeolocation.io/)
- Weather data by [OpenWeatherMap](https://openweathermap.org/)

## Disclaimer

This is an unofficial, community-maintained project not affiliated with or endorsed by Dexcom, Inc. Always verify glucose readings with an official Dexcom receiver or app before making medical decisions. This watchface is a convenience tool only.

> **Credential storage notice:** Your Dexcom password is stored in the Rat Scout Glucose plugin's `Pebble.secureStorage` on your phone, which only that plugin can read (the Pebble plugins preview guide says the phone's keystore encrypts it; not independently verified). Your Dexcom login and region are in the plugin's plain localStorage. Older Rat Scout versions kept all three in plain text in the watchface's settings; the current watchface deletes them on start. Your Dexcom Share credentials provide access to your full glucose history — treat them with the same care as any medical account password and ensure your phone is protected with a screen lock.