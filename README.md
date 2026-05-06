# Rat Scout — Dexcom CGM Watchface for Pebble

A feature-rich Pebble watchface that displays Dexcom continuous glucose monitoring (CGM) data alongside weather, astronomy, and daily life information.

## Overview

Rat Scout connects to the Dexcom Share API to display real-time blood glucose readings on your Pebble smartwatch. In addition to glucose tracking, it shows current time, date, week number, weather conditions (temperature, wind speed, umbrella indicator), sunrise/sunset and moonrise/moonset times, moon phase, step count, garbage collection schedule, and battery status — all on a single watchface.

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
- **Timeline Quick View alerts**: on every threshold or hourly vibration a short-lived Rebble timeline pin is pushed so the native Quick View overlay shows the alert text on screen
- **Multi-region Dexcom**: US, Outside-US (OUS), and Japan servers

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

### Audio Alerts
- **Optional melodies** on every BG or hourly vibration (off by default)
- **Three melodies**: BG High (C4→C5 ascending sine), BG Low (C5→C4 descending sine), Hourly (two short G4 pulses)
- **Volume**: Low / Medium / High
- Audible on Diorite and Emery; silent no-op on Basalt (no speaker hardware)
- Plays in parallel with vibration; also triggered by the Clay Test buttons

### Status Bar
- **Hourly vibration indicator**: shows when hourly chime is enabled
- **Umbrella indicator**: highlights when rain is expected
- **Garbage collection**: underscores the next bag type (Organic / Grey / Black) based on weekly schedule, rolls over at 9 AM

### Other
- **Battery indicator**: visual bar with charging animation
- **Step count**: daily steps from Pebble Health (on supported platforms)
- **Persistent state**: data persists across app restarts
- **Cross-platform**: Basalt, Diorite, Emery (Chalk and Aplite excluded — see [scripts/README.md](scripts/README.md))
- **Adaptive layout**: repacks the watchface when a Quick View overlay is on screen
- **Timeline Quick View alerts**: pushes a Rebble timeline pin on every vibration so the system Quick View shows the alert text
- **Audio alerts** (optional): plays a short melody simultaneously with each vibration on platforms with a speaker (Diorite, Emery); same code runs silently on Basalt

## Requirements

- **Pebble smartwatch** (any platform)
- **Dexcom Share account** with a connected CGM transmitter
- **Pebble/Rebble app** on your phone
- **Internet connection** on phone for API access

## Configuration

Open Rat Scout settings from the Pebble/Rebble app on your phone.

### Dexcom Account
| Setting | Description |
|---------|-------------|
| Login | Dexcom Share account email/username |
| Password | Dexcom Share account password |

### Display
| Setting | Description |
|---------|-------------|
| BG Units | mg/dL or mmol/L |
| Show BG Delta | Toggle glucose rate of change |
| Show Time Delta | Toggle time since last reading |

### Notifications
| Setting | Description |
|---------|-------------|
| Hourly Vibration | Double-pulse every hour on the hour |
| BG Threshold Vibration | Enable/disable glucose threshold alerts |
| Low BG Threshold | Alert threshold in your preferred units |
| High BG Threshold | Alert threshold in your preferred units |
| Night Low Threshold | Optional low threshold during the night window |
| Night High Threshold | Optional high threshold during the night window |
| Night Start | Hour when night thresholds activate (0-23) |
| Night End | Hour when night thresholds deactivate (0-23) |

Night thresholds allow you to use different alerting ranges while you sleep (e.g., wider range to avoid unnecessary vibrations). If the night threshold fields are left empty or no night time frame is set, the general thresholds are used around the clock. The night window supports crossing midnight (e.g., start=22, end=7).

### Alerts
| Setting | Description |
|---------|-------------|
| Alert Overlay Enable | Push a Rebble timeline pin on every vibration so Quick View shows the alert |
| Alert Overlay Duration | Preview duration hint (1–15 s); actual Quick View duration is 1 minute minimum |
| Alert Sound Enable | Play a melody with every vibration (default off) |
| Alert Sound Volume | Low (quiet) / Medium / High |

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

All settings are stored locally on your phone.

## Architecture

```
src/
├── c/
│   ├── rat_scout.c          # Main watchface: window lifecycle, tick handler, shared globals
│   ├── rat_scout.h          # Central header: all externs, enums, macros, prototypes
│   ├── layout.c             # Platform-specific GRect constants (normal + compact modes)
│   ├── glucose.c            # BG display, delta formatting, threshold vibration + alert
│   ├── messaging.c          # AppMessage inbox/outbox routing (inbox + outbox handlers)
│   ├── audio.c              # Speaker melodies (SpeakerNote arrays, play/enable/volume)
│   ├── draw_procs.c         # Custom draw callbacks (battery, status bar, sun/moon corner)
│   └── ui_helpers.c         # Layer factory helpers, deferred persist write utilities
└── pkjs/
    ├── index.js              # App orchestrator: settings, data fetching, message queue
    ├── dexcom.js             # Dexcom Share API client (auth + glucose readings)
    ├── weather.js            # OpenWeatherMap 2.5 API (current + forecast)
    ├── geolocation.js        # ipgeolocation.io astronomy API client
    ├── astronomy.js          # Astronomy time calculations (next sun/moon event logic)
    ├── timeline.js           # Rebble timeline pin push/delete (Quick View alerts)
    └── config.json           # Clay settings UI definition
```

### Data Flow

```
Phone JS ─→ Dexcom Share API ─→ Parse glucose + calculate delta ─┐
         ─→ ipgeolocation.io ─→ Astronomy data (cached daily)   ─┤
         ─→ OpenWeatherMap   ─→ Weather data (cached per interval)─┤
                                                                   ├─→ Message Queue ─→ Pebble Watch
                                                Settings ──────────┘

Pebble Watch ─→ MSG_TYPE_ALERT (kind + value) ─→ Phone JS ─→ timeline.js
                                                       └─→ PUT /v1/user/pins/<id> (Rebble API)
                                                       └─→ DELETE /v1/user/pins/<id> after duration
```

Glucose + astronomy data are sent as a single message. Weather data is sent as a separate message. A message queue ensures only one `sendAppMessage` call is in flight at a time.

Alert messages flow in the opposite direction — from the watch up to JS — carrying an `AlertKind` discriminator (`BG_HIGH=1`, `BG_LOW=2`, `HOURLY=3`) and a formatted value string. JS pushes a short-lived Rebble timeline pin (`PUT` immediately, scheduled `DELETE` after the configured duration) so the system Quick View overlay surfaces the text naturally.

### Adaptive Layout

When a timeline Quick View overlay slides up from the bottom of the screen, the watchface reconfigures itself using the `unobstructed_area_service` SDK callbacks:

- **Normal mode**: full 144×168 / 200×228 layout — all layers visible.
- **Compact mode** (Quick View visible): bottom data layers (date, week, sun/moon, weather, steps) are hidden; time and BG layers are resized to fill the freed vertical space.

The single entry point is `layout_apply_unobstructed(GRect unobs)` in `rat_scout.c`, called from `on_will_change` (pre-animation, for smooth frame transition) and from `on_did_change` (post-animation, for final state). The background bitmap always fills the full screen bounds to prevent flicker behind the overlay.

### Watchface Layout

![Watchface Layout](resources/img/rat_scout.png)

## Development

### Running in Emulator (Codespace / Local)

```bash
# Default (basalt platform):
./scripts/run-emulator.sh

# With logs and specific platform:
./scripts/run-emulator.sh --platform diorite --logs

# See all options:
./scripts/run-emulator.sh --help
```

See [scripts/README.md](scripts/README.md) for the full emulator setup guide — prerequisites, Codespaces port forwarding, browser override, geolocation override, testing alerts, and platform support matrix.

### Running Tests

```bash
npm test
```

All `test/*.test.js` files are executed with Node.js. No test framework dependency — the hand-rolled runner follows the pattern in `test/run-all.sh`.

## Building

Requires Pebble SDK 4 (installed via `uv tool install pebble-tool --python 3.13` — see [scripts/README.md](scripts/README.md) for full setup instructions).

```bash
pebble build
pebble install --phone <phone_ip>
```

Run JS unit tests:

```bash
npm test
```

## Credits

- Dexcom API approach inspired by [pydexcom](https://github.com/gagebenne/pydexcom)
- Settings UI powered by [Pebble Clay](https://github.com/pebble/clay)
- Astronomy data by [ipgeolocation.io](https://ipgeolocation.io/)
- Weather data by [OpenWeatherMap](https://openweathermap.org/)

## Disclaimer

This is an unofficial, community-maintained project not affiliated with or endorsed by Dexcom, Inc. Always verify glucose readings with an official Dexcom receiver or app before making medical decisions. This watchface is a convenience tool only.

> **Credential storage notice:** Your Dexcom username and password are stored in plain text in the Pebble app's local storage on your phone. This is a limitation of the Pebble SDK and cannot be worked around. Your Dexcom Share credentials provide access to your full glucose history — treat them with the same care as any medical account password and ensure your phone is protected with a screen lock.