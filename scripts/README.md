# Rat Scout — Emulator Setup & Usage Guide

This guide covers everything needed to run the Rat Scout watchface in the Pebble emulator on a fresh GitHub Codespace or local Linux box.

---

## Overview

The emulator stack consists of four layers running together inside the script session:

| Component | Role |
|---|---|
| **QEMU** | Hardware emulator for each Pebble platform binary |
| **pypkjs** | PebbleKit JS runtime — runs the watch's JavaScript (index.js, timeline.js, etc.) |
| **websockify** | Bridges QEMU's VNC output to a WebSocket at port 6080 |
| **noVNC** | In-browser VNC viewer served over that WebSocket |

`run-emulator.sh` starts all of the above in the correct order, injects optional location overrides, and cleans everything up on exit (Ctrl+C or shell close).

### Scripts in this directory

| File | Purpose |
|---|---|
| [`run-emulator.sh`](run-emulator.sh) | Main entry point — orchestrates the full emulator session |
| [`browser_override.py`](browser_override.py) | Replaces the SDK's `browser.py` to serve the Clay settings page from a local server, bypassing URL-length limits in lightweight browsers |
| [`geolocation_override.py`](geolocation_override.py) | Replaces pypkjs's `geolocation.py` to return fixed GPS coordinates when `--loc` is used |

---

## Prerequisites

### System libraries

```bash
sudo apt-get install -y \
  libsdl2-2.0-0 \
  libglib2.0-0 \
  libpixman-1-0 \
  zlib1g \
  libsndio7.0
```

`libsndio7.0` is required for audio output on Diorite/Emery emulators. Without it, audio calls are silently ignored — the emulator still runs.

### Python

Python 3.13 is recommended (used during SDK install):

```bash
# Install uv (fast Python toolchain manager):
curl -Ls https://astral.sh/uv/install.sh | sh
```

### Pebble SDK

```bash
# Install the pebble-tool CLI (this pulls in the full SDK machinery):
uv tool install pebble-tool --python 3.13

# Install the latest SDK (4.9.x at time of writing):
pebble sdk install latest
```

The SDK installs to `~/.pebble-sdk/SDKs/`. Running `pebble sdk list` shows all installed versions.

### Node.js

Required only for running JS unit tests (`npm test`). Node 18+ recommended. Most Codespace images include it.

---

## Quick Start

```bash
# Build the app, then launch it in the basalt emulator:
./scripts/run-emulator.sh --build

# If the app is already built, skip the build step:
./scripts/run-emulator.sh
```

The script prints a URL like `http://localhost:6080` (or a Codespaces forwarding URL). Open it in your browser to see the watchface.

---

## CLI Reference

```
Usage: ./scripts/run-emulator.sh [OPTIONS]

Run the Rat Scout watchface in the Pebble emulator.

OPTIONS:
  --platform <name>   Emulator platform: aplite, basalt, chalk, diorite, emery
                      Default: basalt
  --loc <name>        Override emulator location (e.g. Malta, Moscow, Tokyo)
                      Geocodes via Open-Meteo (no API key needed), sets TZ,
                      injects fixed GPS coordinates into weather/astronomy calls.
  --build             Run pebble clean + pebble build before installing.
                      Build is skipped by default.
  --logs              Accepted for backward compatibility (logs are always shown).
  --help, -h          Show help message and exit.
```

### `--platform`

Controls which Pebble hardware model the emulator simulates:

| Platform | Screen | Speaker | Color | Notes |
|---|---|---|---|---|
| `basalt` | 144×168 | No | Yes | Pebble Time — **default** |
| `diorite` | 144×168 | Yes | No | Pebble 2 — grayscale + speaker |
| `emery` | 200×228 | Yes | Yes | Pebble Time 2 — larger screen + speaker |
| `aplite` | 144×168 | No | No | Pebble Classic — **not in targetPlatforms** |
| `chalk` | 180×180 (round) | No | Yes | Pebble Time Round — **not in targetPlatforms** |

> **Note:** Aplite and Chalk are excluded from `targetPlatforms` in `package.json`. Using `--platform aplite` or `--platform chalk` in the emulator will work for informal testing but the app is not built or tested for those platforms.

### `--loc`

Geocodes a city name using [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api) (free, no API key) and exports:

- `TZ` — timezone string sent to the emulator so the clock shows local time
- `PEBBLE_GEO_LAT` / `PEBBLE_GEO_LON` — coordinates injected by `geolocation_override.py` into every `navigator.geolocation.getCurrentPosition()` call from the JS side

This means weather and astronomy data will reflect the requested city's coordinates.

```bash
./scripts/run-emulator.sh --platform diorite --loc Malta
./scripts/run-emulator.sh --platform emery --loc Tokyo
```

### `--build`

Forces a clean build before installing:

```bash
./scripts/run-emulator.sh --build
# equivalent to: pebble clean && pebble build && pebble install --emulator <platform>
```

Without `--build`, the script installs the existing `build/rat_scout.pbw` directly.

---

## Codespaces Walkthrough

1. Open a terminal in your Codespace and run `./scripts/run-emulator.sh`.
2. The script prints a URL such as:
   ```
   ==> noVNC at: http://localhost:6080
   ```
3. VS Code will detect the new port and show a notification: **"Open in Browser"**. Click it.
4. Alternatively, open the **Ports** tab in VS Code and click the globe icon next to port 6080.

> **Important:** Port 6080 must be set to **Public** visibility in the Ports tab (or in `.devcontainer/devcontainer.json`) for the forwarded URL to work from your local browser. If you created the Codespace before the devcontainer declaration existed, toggle the visibility manually.

### Opening the Clay settings page

The Clay config page is served via the Pebble JS runtime during an active emulator session. To open it:

1. With the emulator running, click the middle button on the on-screen Pebble (opens settings).
2. VS Code will auto-forward the settings port and offer an "Open in Browser" notification.
3. The Clay page will load in your browser. Adjust settings, click **Save Settings**.

---

## Browser Override Mechanism

**File:** [`browser_override.py`](browser_override.py)

**Why it exists:**  
Clay embeds the full settings-page HTML (~100 KB) as a URL-encoded hash fragment in the config URL. VS Code Simple Browser and many lightweight browsers silently truncate long URLs at the `#` character, which strips the entire settings payload and breaks the config page.

**What it does:**  
The override intercepts the SDK's browser open call, extracts the HTML from the fragment, injects the `return_to` callback URL, and serves it from a local HTTP server at `/config`. The browser is pointed to the short URL `http://localhost:<port>/config` instead.

**Lifecycle:**  
`run-emulator.sh` copies the override into the SDK's `pebble_tool/util/` directory at startup, saving the original as `browser.py.orig`. On exit (Ctrl+C, normal completion, or script error), `cleanup()` restores the original and clears the `.pyc` cache so subsequent SDK invocations see the unmodified file. SDK upgrades are therefore safe — the override is never a permanent change.

---

## Geolocation Override Mechanism

**File:** [`geolocation_override.py`](geolocation_override.py)

**Why it exists:**  
The default pypkjs geolocation module performs an IP-based location lookup. For emulator sessions inside a Codespace or CI runner, this returns a data-centre IP (often in Virginia, USA) rather than the developer's actual location — breaking weather and astronomy data.

**What it does:**  
When `PEBBLE_GEO_LAT` and `PEBBLE_GEO_LON` are set (populated by `--loc`), the override returns those fixed coordinates immediately instead of doing an IP lookup. When those variables are absent, it falls back to the original IP-based lookup.

**Lifecycle:**  
Same swap-and-restore pattern as `browser_override.py`. The original pypkjs `geolocation.py` is restored on exit.

---

## Testing Alerts

### Test High / Low / Hourly via Clay

1. Open the Clay settings page (see above).
2. Scroll to the **Vibration Test** section.
3. Click **▶ Test High BG Alert**, **▶ Test Low BG Alert**, or **▶ Test Hourly Vibration**.
4. The settings page closes, settings are saved, and the vibration pattern fires on the emulator.
5. If **Enable Audio Alerts** is on, the corresponding melody also plays (Diorite/Emery only).
6. The watch JS sends a `MSG_TYPE_ALERT` message to PebbleKit JS, which pushes a Rebble timeline pin (requires a valid Rebble token in the Alerts config section).

### Triggering a real timeline pin

From within a running emulator session, you can push a pin directly via the pkjs HTTP log or by opening the Rebble timeline API endpoint with your token. The alert flow is:

```
watch C → MSG_TYPE_ALERT (outbox) → pkjs index.js → timeline.js
        → PUT https://timeline-api.rebble.io/v1/user/pins/<id>
        → Quick View slides up from screen bottom
```

A scheduled DELETE fires after the configured overlay duration.

### Toggling Quick View in the emulator

The Pebble emulator does not expose a direct control to toggle Quick View without a real timeline event. The most reliable way to trigger the adaptive layout is:

1. Set up a valid Rebble token in the Alerts config section.
2. Trigger a Test High/Low/Hourly from Clay — this pushes a real pin via the Rebble API.
3. The system Quick View will slide up when the pin time is imminent (within ~30 seconds).

Alternatively, use `pebble emu-app-config` to open the config page and manually construct a timeline PUT request in the browser console pointing at the Rebble API.

---

## Audio in the Emulator

Audio output on Diorite and Emery emulators requires `libsndio7.0`:

```bash
sudo apt-get install -y libsndio7.0
```

The emulator routes speaker audio through `sndio` (or PulseAudio on some systems). If the library is missing, `speaker_play_notes()` executes without error but no sound is produced.

**Expected behavior by platform:**

| Platform | Audio |
|---|---|
| `diorite` | Audible via sndio if `libsndio7.0` is installed |
| `emery` | Audible via sndio if `libsndio7.0` is installed |
| `basalt` | Silent — no speaker hardware; `speaker_play_notes()` is a no-op at runtime |

**Melodies:**

| Alert | Notes | Duration |
|---|---|---|
| BG High | C4 → C5 (ascending sine) | 500 ms + 1000 ms |
| BG Low | C5 → C4 (descending sine) | 500 ms + 1000 ms |
| Hourly | G4, rest, G4 | 300 ms + 100 ms + 300 ms |

---

## Troubleshooting

### Port 6080 already in use

```bash
pkill -f 'websockify.*6080'
```

Then re-run the script.

### Xvfb missing

The script auto-installs `xvfb` if absent, but if that fails:

```bash
sudo apt-get install -y xvfb
```

### Pebble SDK install failures

1. Clear the SDK cache and retry:
   ```bash
   rm -rf ~/.pebble-sdk/SDKs/current
   pebble sdk install latest
   ```
   > **Warning:** `rm -rf ~/.pebble-sdk/SDKs/current` is destructive — this permanently deletes the cached SDK. Only run this to fix a broken install.

2. Ensure Python 3.13 is being used by uv:
   ```bash
   uv tool install pebble-tool --python 3.13 --force
   ```

### Geocoding API rate limits

The Open-Meteo geocoding API has a free tier with generous limits (~10 000 req/day). If you hit a limit:

```
Error: geocoding API request failed (network error)
```

Wait a few minutes or pass coordinates directly via environment variables instead:

```bash
export PEBBLE_GEO_LAT=35.6762
export PEBBLE_GEO_LON=139.6503
export TZ=Asia/Tokyo
./scripts/run-emulator.sh
```

### Clay settings page shows blank or JS errors

This is usually a URL fragment truncation issue. Verify `browser_override.py` is being applied:

```
==> Installing browser_override.py
```

should appear in the script output. If not, check that the SDK path resolved correctly (output line: `==> SDK browser.py path: ...`).

### Stale pebble-tool cache

If the app installs but the watchface behaves unexpectedly after a code change, force a rebuild:

```bash
./scripts/run-emulator.sh --build
```

---

## Platform Support Matrix

| Platform | `targetPlatforms` | Screen | Speaker | Color |
|---|---|---|---|---|
| basalt | ✅ | 144×168 | No | Yes |
| diorite | ✅ | 144×168 | Yes | No |
| emery | ✅ | 200×228 | Yes | Yes |
| aplite | ❌ | 144×168 | No | No |
| chalk | ❌ | 180×180 (round) | No | Yes |

Aplite was excluded because it supports neither Quick View nor the Speaker API. Chalk is excluded pending layout work for the round screen.

The adaptive layout (compact mode for Quick View) and audio alerts (Phase 2) are implemented without platform `#if` guards — `speaker_play_notes()` is a universal SDK call that returns silently on non-speaker hardware.
