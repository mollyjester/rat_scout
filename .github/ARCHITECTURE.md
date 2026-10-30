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
│   │   ├── utils.js       # Shared JS utilities (used by pkjs modules)
│   │   └── dexcom_guard.js # Dexcom login guard shared by the plugin and PKJS fallback
│   ├── plugin-src/        # Plugin sources (ES5 + Promise); bundled into src/plugin/index.js
│   │   ├── main.js        # health/glucose source handler, cache, throttle
│   │   └── xhr_shim.js    # XMLHttpRequest subset on fetch, so dexcom.js runs unchanged
│   ├── plugin/
│   │   └── index.js       # GENERATED plugin script (package.json plugin.script); never edit
│   └── pkjs/
│       ├── index.js        # PebbleKit JS entry: app lifecycle, settings, message queue, data fetching
│       ├── config.json     # Clay settings UI definition (all user-facing settings)
│       ├── clay-config.js  # Clay custom function: attaches click handlers for test buttons
│       ├── dexcom.js       # Dexcom Share API client (auth + glucose fetch); also bundled into the plugin
│       ├── glucose.js      # Glucose fetch + BG/delta formatters (formatters also bundled into the plugin)
│       ├── glucose_plugin.js # Glucose source selection: own plugin vs direct Dexcom, fallback, watchdog, gate
│       ├── weather.js      # OpenWeatherMap API client (current + forecast, smart cache)
│       ├── geolocation.js  # ipgeolocation.io astronomy API client
│       ├── astronomy.js    # Astronomy time calculations (next sun/moon event, phase)
│       └── garbage.js      # Garbage bag schedule computation
├── test/
│   ├── helpers/plugin_host.js  # Loads the plugin bundle in a vm with mock host APIs
│   ├── astronomy.test.js
│   ├── clay-config.test.js
│   ├── dexcom.test.js
│   ├── dexcom_guard.test.js
│   ├── glucose_plugin.test.js
│   ├── plugin.test.js
│   ├── garbage.test.js
│   ├── glucose.test.js
│   ├── utils.test.js
│   └── weather.test.js
└── scripts/
    ├── run-emulator.sh        # Convenience wrapper: pebble install --emulator
    ├── build-plugin.js        # Bundles src/plugin-src/ into src/plugin/index.js (--check verifies)
    ├── browser_override.py    # Override browser for Pebble config in Codespaces
    ├── settings.json          # Template for run-emulator.sh --settings
    └── settings.md            # Reference for every settings key
```

## Target Platforms
flint, emery (`package.json` `targetPlatforms`; `pebble build` builds only these).

## Permissions (`usesPermissions`)
Declared in `package.json` `pebble.usesPermissions`, for the phone app's plugin-era permission system:

| Permission | Why |
|---|---|
| `Location` | `navigator.geolocation` in `index.js` (astronomy, weather) and `weather.js` |
| `Internet` → `share2.dexcom.com`, `shareous1.dexcom.com`, `share.dexcom.jp` | Dexcom Share regions (`dexcom.js` base URLs) |
| `Internet` → `api.openweathermap.org` | `weather.js` |
| `Internet` → `api.ipgeolocation.io` | `geolocation.js` |
| `Glucose` (plugin: own uuid) | Rat Scout's PKJS reading its own plugin. Whether an app must declare its own plugin's permission is UNVERIFIED (the guide shows this only for other plugins); declared to be safe |

- They only take effect when the pbw is marked `manifestVersion: 2` and the user has plugins enabled (Pebble plugins preview guide, "Permissions" and "Declaring": "only in place when plugins are enabled"; "Without that it's a legacy app"). A legacy pbw keeps the old implicit internet + location access.
- SDK 4.33.1 copies the whole `pebble` block into `appinfo.json` but sets no `manifestVersion`, so `pebble build` alone still produces a legacy pbw.
- Keep `Internet` limited to domains the JS actually requests. `pebble convert-manifest --dry-run` also lists hosts found in comments and help text (github.com, openweathermap.org, ipgeolocation.io); those are never requested and are deliberately not declared.

## Plugin (preview) — `health/glucose`
The pbw also carries a phone-side plugin (Pebble plugins preview, mobile app 1.16.x, disabled by default) that serves the latest Dexcom reading to any watchface, app or Index. Category contract (our own; no published `health` category exists yet):

`health/glucose`, one instance, `instanceId: "dexcom"`, `supportsMultiple: false`, `suggestedRefreshIntervalSec: 60`, caller permission `Glucose` (defined by the plugin, kind `read`, label "Read your glucose readings").

| Property | Shapes | Notes |
|---|---|---|
| `name` | shortText | "Dexcom" |
| `status` | shortText, longText | `ok` with a reading; `busy` (no glucose properties) when another context is logging in and nothing is cached |
| `glucose` | numericValue, shortText, longText | User's units (`clay-settings` `BG_UNITS`). mg/dL: min 40, max 400; mmol/L: 1 decimal, min 2.2, max 22.2. Long: "120 mg/dL →" |
| `delta` | numericValue, shortText | User's units, "+5". Omitted with a single reading |
| `glucose_mgdl` | numericValue | Always integer mg/dL, no min/max: the lossless value Rat Scout's own PKJS reads |
| `delta_mgdl` | numericValue | Integer mg/dL. Omitted with a single reading |
| `trend` | shortText, longText | Arrow (dexcom.js `TREND_ARROWS`) and a description |
| `trend_code` | longText | Raw Dexcom `Trend` |
| `reading_time` | timestamp | Epoch seconds |

Answers:
- No credentials, Dexcom failure, rejected login, login paused → `instances: []`, `validUntilMs` now + 60 s.
- Wrong category/item → `respond.error('INVALID_REQUEST')`; an exception → `UNKNOWN` (from the host shim).
- Reading younger than 310 s (cached, same credentials) → served from cache, no Dexcom call; `validUntilMs = max(now + 60 s, (ts + 310) * 1000)`.
- Dexcom is called at most once per 55 s (`ratscout.plugin.lastAttempt`; 55 rather than 60 so jitter in a 60 s poll never skips one).
- Login lock held by PKJS, or throttled → cached reading if any (any age), else the `busy` instance (`validUntilMs` now + 30 s).

Runtime: a plugin "is started fresh for each request" (preview guide), so all state is in localStorage, which is shared with PKJS. The plugin reads Clay's `clay-settings` (`DEX_LOGIN`, `DEX_PASSWORD`, `DEX_REGION`, `BG_UNITS`) and shares PKJS's `accountId` / `sessionId` session keys. Credentials stay in `clay-settings`: `Pebble.secureStorage` is private to the plugin and there is no PKJS → plugin channel without a `configPage`.

HTTP: dexcom.js uses XMLHttpRequest; the preview guide documents only `fetch` ("Nothing else"), so the bundle binds `src/plugin-src/xhr_shim.js` as `XMLHttpRequest` in bundle scope (never as a global), and `setTimeout`/`clearTimeout` to the runtime's if present, else no-ops. Phone-side availability of XHR and setTimeout is UNVERIFIED; the emulator has both (`pypkjs/plugins/js_plugin.py` installs Timers and XHRExtension), which is why the shim is used unconditionally.

### Glucose source selection (`src/pkjs/glucose_plugin.js`)
PKJS reads BG from its own plugin when the phone app offers it, else fetches Dexcom directly as before.

| Mode | Glucose comes from | Entered when |
|---|---|---|
| `direct` | `fetchGlucoseReading` (no guard): exactly the pre-plugin behaviour | no `Pebble.subscribeToSource`/`enumeratePlugins`, `enumeratePlugins` throws or does not list our uuid with `health/glucose`, or `INVALID_REQUEST` |
| `pending` | nothing yet | `ready`: subscribed with `plugin: <own uuid>`; grace timer 30 s |
| `plugin` | the subscription's envelopes | any `onData` (empty included: it shows the host is alive) |
| `fallback` | `fetchGlucoseReading` with the login guard; subscription kept | see errors below, grace expiry, or the stall watchdog |

Errors (`onError(err)`, by `err.code` only; whether `err.message` carries the plugin's text is UNVERIFIED):

| Code | Action |
|---|---|
| `INVALID_REQUEST` | unsubscribe, `direct`, one direct fetch |
| `PERMISSION_DENIED`, `PLUGIN_UNAVAILABLE` | `fallback` + one direct fetch, keep the subscription (the guide: `PERMISSION_DENIED` lasts until the user answers; an error does not end a subscription) |
| anything else | count; `fallback` + one direct fetch at the 2nd consecutive error, while `pending`, or if no envelope for 11 min |

- **Grace:** still `pending` 30 s after subscribing → `fallback` + one direct fetch.
- **Stall watchdog:** `checkStall(now)` at the top of `fetchAllData()` (runs on `ready`, `webviewclosed` and every watch ping, at least every 5 min, `rat_scout.c` tick handler). In `plugin` mode with no envelope for more than 11 min → `fallback`, and that same `fetchAllData()` fetches directly. A later envelope returns to `plugin`. An old reading timestamp alone (sensor gap) never triggers it.
- **Envelope → watch:** an instance with `glucose_mgdl` + `reading_time` becomes `{current: {_value, _delta: delta_mgdl or null, _datetime}}` passed to the same `Glucose.buildGlucoseDictionary` the direct path uses, so the dictionary is byte-identical (no mmol round trip). `status: busy` sends nothing (the watch keeps its value). Anything else sends `"---"` with `TIMESTAMP 0`, as the direct path does on failure.
- **Plugin gate:** a plugin dictionary whose `BG` and `TIMESTAMP` equal the last glucose message sent (by either path) is dropped, which stops repeat host refreshes and the first envelope after a fallback. The direct path is never gated: it goes through `recordingSend`, which only records. That keeps three existing flows intact: catch-up polling (every glucose message sets `s_next_fetch_time = ts + 305`, `messaging.c`, so a repeated reading makes the watch ping every minute until a new one), settings re-sends (`BGDELTA`/`BG_SHOW_TIMEDELTA` only arrive in glucose messages, `messaging.c`), and restarts. Alerts are unaffected: they fire only on a zone change (`glucose.c`, `new_zone != s_bg_zone`).
- **Settings saved:** `onSettingsChanged()` clears the gate and resubscribes, so the next envelope is re-formatted and sent. Whether the phone host reads immediately on subscribe is UNVERIFIED (the emulator does: `pypkjs/plugins/base.py` `observe()` reads before its first wait); otherwise the change shows within one refresh (60 s).
- **Guard:** `guardFor()` returns a `pkjs` guard only in `fallback`; `fetchGlucoseReading` then skips the login (sending nothing) while the plugin holds the lock or the credentials are paused, ignores a session recorded for other credentials, and records the outcome. With no guard (`direct`) it is unchanged.
- All watch messages still go through `sendToPebble()`.

### Plugin pbw
- `python3 -I scripts/pack-plugin.py` → `build/rat-scout-plugin.pbw`: `pebble clean` + `pebble build`, then sets `manifestVersion: 2` and adds `plugin.script` (`src/plugin/index.js`) at its project-relative path, as PebbleOS PR #2483 and pebble-plugins' `pack-plugin-pbw.py` do. `build/<dir>.pbw` stays the legacy pbw.
- Validation mirrors PR #2483 and pypkjs 3.0.3 `plugins/manifest.py`: permission name alphanumeric and not `InvokeAction`, a label, `kind` in `read`/`write`/`exfiltrating`. The preview guide also lists `dangerous`; neither validator accepts it, so we use `read`.
- Upstream `pack-plugin-pbw.py` is not used: it opens `build/<package name>.pbw` (`build/Rat Scout.pbw`), while `pebble build` names the pbw after the directory; and the pebble-plugins repo has no LICENSE.
- No published SDK contains PR #2483 (merged 2026-10-19): `sdk.repebble.com/v1/files/sdk-core` lists up to 4.33.1, and PebbleOS releases ship only firmware and QEMU images. When one appears, the packer detects a plugin-aware pbw and copies it unchanged.

### Shared localStorage keys
| Key | Writer | Contents |
|---|---|---|
| `clay-settings` | Clay (PKJS) | Settings; read by the plugin |
| `accountId`, `sessionId` | PKJS and plugin | Dexcom session |
| `ratscout.plugin.lastReading` | plugin | `{credKey, value, delta, trend, arrow, ts}`, raw mg/dL |
| `ratscout.plugin.lastAttempt` | plugin | Epoch ms of the last Dexcom call |
| `ratscout.auth.inflight` | plugin, PKJS fallback | `{owner, at}` login lock, TTL 45 s |
| `ratscout.auth.badcreds` | plugin, PKJS fallback | `{credKey, until}`: no login for 15 min after a rejection, unless the credentials change |
| `ratscout.auth.sessionCredKey` | plugin, PKJS fallback | credKey of the stored session; a mismatch forces a new login (no key = trusted) |

`credKey` is a djb2 hash of `login|region|password`: a change detector, not security.

### Login guard (`src/common/dexcom_guard.js`)
- A login is needed when there is no usable session. Before it: skip if `badcreds` matches, or if a lock younger than 45 s exists; otherwise take the lock. The lock is released (by its owner only) in both outcomes.
- Rejections: only `Invalid credentials` / `Login failed` (zero GUID, dexcom.js). HTTP 4xx/5xx, network errors and timeouts are transient and never pause; they retry at the normal cadence (plugin throttle 55 s, watch catch-up polling once per minute), the rate the direct path has run against Dexcom for over a year.
- Session-error re-authentication inside dexcom.js is not guarded (bounded to 2 retries per run).
- Dexcom's lockout and rate-limit thresholds are UNVERIFIED and are never tested against the real service; the guard is deliberately conservative and verified only by unit tests with a mocked fetch.

### Build
- `node scripts/build-plugin.js` regenerates `src/plugin/index.js` (modules in a small IIFE module table); `--check` fails if it is stale, and `test/plugin.test.js` checks the same.
- SDK 4.33.1 copies the `plugin` block into `appinfo.json` (after a clean build: the bundle step does not track appinfo changes) but neither sets `manifestVersion` nor adds the script to the pbw, and does not validate `definesPermissions` (a bogus `kind` builds fine). So `pebble build` alone does not produce a plugin pbw.

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
  Pebble ready → getSettings() → sendSettings() → glucoseSource.start() → fetchAllData()
  webviewclosed → clay.getSettings() → sendSettings() → glucoseSource.onSettingsChanged() [then test command if flagged]
  plugin subscription onData → envelope → gate → MSG_TYPE_GLUCOSE (plugin mode)

  fetchAllData():
    glucoseSource.checkStall()
    Glucose.fetchGlucoseReading() → MSG_TYPE_GLUCOSE   (direct / fallback modes only)
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
