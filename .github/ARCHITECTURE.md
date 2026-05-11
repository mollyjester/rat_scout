# Rat Scout — Architecture Overview

## Investigation discipline
Before stating any technical behavior as fact (SDK semantics, hardware sharing, peripheral interaction, platform identity), verify against primary sources: PebbleOS at `/tmp/PebbleOS`, SDK headers, or board configs. Cite file paths and line numbers. Never assume the user's device platform — ask.

## Repository Layout

```
rat_scout/
├── package.json          # Pebble app manifest: UUID, platforms, messageKeys, resources
├── wscript               # Waf build script (pebble build entry point)
├── resources/
│   ├── fonts/
│   │   └── Humaroid.ttf  # Custom font used at 20/28/32/64px
│   └── img/              # All bitmap resources (PNG)
│       ├── bg.png                  # Full-screen watchface background
│       ├── danger.png              # Alert overlay icon: BG high/low (24×24, transparent)
│       ├── clock5.png              # Alert overlay icon: hourly (24×24, transparent)
│       ├── sun.png, hourly.png, umbrella.png  # Status bar icons
│       ├── temperature.png, wind.png, steps.png  # Info row icons
│       ├── {new,waxing*,first*,full,waning*,third*}moon.png  # 8 moon phase icons
│       └── {organic,grey,black}bag.png, rat_scout_icon.png
├── src/
│   ├── c/
│   │   ├── rat_scout.h    # Shared header: all externs, enums, constants, prototypes
│   │   ├── rat_scout.c    # Core: window lifecycle, tick handler, UI layer setup/teardown
│   │   ├── overlay.c      # Transient overlay banner (Quick View Alerts feature)
│   │   ├── glucose.c      # BG rendering, delta display, threshold vibration logic
│   │   ├── sounds.c       # Polyphonic alert melodies (low/high BG, hourly chime) via Speaker API
│   │   ├── messaging.c    # AppMessage inbox/outbox callbacks, settings/data dispatch
│   │   ├── draw_procs.c   # Custom GPath and layer draw procedures (battery, status bar, corners)
│   │   ├── layout.c       # Layer position constants and create_text_layer / create_icon_layer helpers
│   │   └── ui_helpers.c   # Shared utilities: persist_write_string_if_changed, destroy_icon_layer, etc.
│   ├── common/
│   │   └── utils.js       # Shared JS utilities (used by pkjs modules)
│   └── pkjs/
│       ├── index.js        # PebbleKit JS entry: app lifecycle, settings, message queue, data fetching
│       ├── config.json     # Clay settings UI definition (all user-facing settings)
│       ├── clay-config.js  # Clay custom function: attaches click handlers for test buttons
│       ├── dexcom.js       # Dexcom Share API client (auth + glucose fetch)
│       ├── weather.js      # OpenWeatherMap API client (current + forecast, smart cache)
│       ├── geolocation.js  # ipgeolocation.io astronomy API client
│       ├── astronomy.js    # Astronomy time calculations (next sun/moon event, phase)
│       └── garbage.js      # Garbage bag schedule computation
├── test/
│   ├── astronomy.test.js
│   ├── clay-config.test.js
│   ├── dexcom.test.js
│   ├── garbage.test.js
│   ├── glucose.test.js
│   ├── utils.test.js
│   └── weather.test.js
└── scripts/
    ├── run-emulator.sh        # Convenience wrapper: pebble install --emulator
    ├── browser_override.py    # Override browser for Pebble config in Codespaces
    └── geolocation_override.py
```

## Target Platforms
aplite, basalt, diorite, emery, flint

## Message Types (C ↔ JS)
| Value | Constant              | Direction  | Handler                   |
|-------|-----------------------|------------|---------------------------|
| 0     | MSG_TYPE_SETTINGS     | JS → C     | handle_settings()         |
| 1     | MSG_TYPE_GLUCOSE      | JS → C     | handle_glucose_message()  |
| 2     | MSG_TYPE_WEATHER      | JS → C     | handle_weather_message()  |
| 3     | MSG_TYPE_ASTRONOMY    | JS → C     | handle_astronomy_message()|
| 4     | MSG_TYPE_VIBE_TEST    | JS → C     | handle_vibe_test()        |
| 5     | MSG_TYPE_OVERLAY_TEST | JS → C     | handle_overlay_test()     |
| 6     | MSG_TYPE_SOUND_TEST   | JS → C     | handle_sound_test()       |
| —     | (outbound ping)       | C → JS     | triggers fetchAllData()   |

## Persist Key Ranges
- 100–112: Data cache (BG reading, delta, sun/moon times, weather, moon phase, vibe/umbrella flags, garbage bag, timestamp)
- 113–117: Settings (overlay enable/duration, BG low/high sound, hourly sound)
- Key 100: PERSIST_KEY_BG
- Key 112: PERSIST_KEY_TIMESTAMP
- Key 113: PERSIST_KEY_OVERLAY_ENABLE
- Key 114: PERSIST_KEY_OVERLAY_DURATION
- Key 115: PERSIST_KEY_BG_LOW_SOUND
- Key 116: PERSIST_KEY_BG_HIGH_SOUND
- Key 117: PERSIST_KEY_HOURLY_SOUND

## Data Flow
```
Phone JS:
  Pebble ready → getSettings() → sendSettings() + fetchAllData()
  webviewclosed → clay.getSettings() → sendSettings() [then test command if flagged]

  fetchAllData():
    Glucose.fetchGlucoseReading() → MSG_TYPE_GLUCOSE
    fetchAndSendWeather()         → MSG_TYPE_WEATHER  (cached per interval)
    fetchAndSendAstronomy()       → MSG_TYPE_ASTRONOMY (cached daily)

Watch C:
  ready → main_window_load → overlay_init (last, top z-order)
  tick_handler (every minute):
    → update_time, update_delta_display, update_steps (every 5 min)
    → hourly vibe + sound + overlay_show at tm_min==0 (each gated by its own toggle)
    → outbound ping to trigger JS fetch when s_next_fetch_time reached
  inbox_received_callback → dispatch by MSG_TYPE
```

## Sound Alerts — sounds.c
- Speaker API: `speaker_play_tracks(SpeakerTrack[], num_tracks, volume)`
- Audible only on platforms with a built-in speaker (Emery, Flint). On aplite/basalt/diorite the SDK calls are silent no-ops, so toggles are harmless.
- `speaker_stop()` is called before each `speaker_play_tracks()` to ensure `prv_sound_finish_cb` fires synchronously before new playback begins. `speaker_play_tracks()` is also self-preempting in PebbleOS, so no idle-status guard is needed.
- All alert tracks wrap their notes in a leading **and** trailing `SILENCE_BUF` (350 ms, midi=0, triangle) to absorb DA7212 cold-start ramp-up on flint/emery.
- High BG alert (ascending B minor arpeggio): single track, `SpeakerWaveformTriangle`
  - B3(125ms)–D4(125ms)–F#4(125ms) | 250ms pause | B3(125ms)–D4(125ms)–F#4(250ms)
- Low BG alert (descending B minor arpeggio): single track, `SpeakerWaveformTriangle`
  - F#4(125ms)–D4(125ms)–B3(125ms) | 250ms pause | F#4(125ms)–D4(125ms)–B3(250ms)
- Hourly chime: single track, two C6 `SpeakerWaveformSine` pulses (125 ms each) separated by a 125 ms silent gap
- Toggles: `s_bg_low_sound` / `s_bg_high_sound` / `s_hourly_sound` (independent of vibration toggles)
- `handle_sound_test()` always plays regardless of toggle (preview)

## Overlay (Quick View Alerts) — overlay.c
- Layer: 51px tall, bottom of screen, hidden by default
- Sections: left text area | 1px divider | 30px right icon container (checkerboard bg)
- Icon: 24×24 PNG centred in container, drawn with GCompOpSet for transparency
- Borders: 2px top + bottom only (screen frame acts as left/right border)
- AlertKind enum: ALERT_KIND_NONE / BG_HIGH / BG_LOW / HOURLY
- BG_HIGH + BG_LOW → RESOURCE_ID_ALERT_DANGER (danger.png)
- HOURLY → RESOURCE_ID_ALERT_CLOCK (clock5.png)
- Auto-dismiss via app_timer_register; re-showing cancels+restarts the timer
- handle_overlay_test() always shows regardless of s_overlay_enabled

## Clay Settings Structure (config.json sections)
1. Dexcom Account (login, password)
2. Display (units, show delta, show time delta, date format)
3. Notifications (hourly vibe + sound, BG vibe + low/high sounds, thresholds, night window)
4. Quick View Alerts (enable toggle, duration select: 3/10/20 s, test button → MSG_TYPE_OVERLAY_TEST)
5. Vibration Test (3 buttons → MSG_TYPE_VIBE_TEST)
6. Sound Test (3 buttons → MSG_TYPE_SOUND_TEST)
7. Astronomy (ipgeolocation.io API key)
8. Weather (OWM API key, units, update interval)
