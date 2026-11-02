# Rat Scout — Architecture Overview

## Investigation discipline
Before stating any technical behavior as fact (SDK semantics, hardware sharing, peripheral interaction, platform identity), verify against primary sources: PebbleOS at `/tmp/PebbleOS`, SDK headers, or board configs. Cite file paths and line numbers. Never assume the user's device platform — ask.

## Repository Layout

```
rat_scout/
├── package.json          # Watchface manifest: UUID, platforms, messageKeys, resources, permissions
├── plugin/               # The Rat Scout Glucose pbw (plugin-only, own uuid)
│   ├── package.json      # Its manifest: projectType plugin, Dexcom domains, plugin block, configPage
│   ├── plugin.js         # GENERATED plugin script (plugin.script); never edit
│   └── config.html       # Its settings page (Dexcom login, password, region, units)
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
│   ├── plugin-src/        # Plugin sources (ES5 + Promise); bundled into plugin/plugin.js
│   │   ├── main.js        # health/glucose source handler, cache, throttle; settings-page handler
│   │   ├── settings.js    # Plugin settings: localStorage + Pebble.secureStorage (password)
│   │   ├── dexcom.js      # Dexcom Share API client (auth + glucose fetch)
│   │   ├── dexcom_guard.js # Dexcom login guard
│   │   └── xhr_shim.js    # XMLHttpRequest subset on fetch, so dexcom.js runs unchanged
│   └── pkjs/
│       ├── index.js        # PebbleKit JS entry: app lifecycle, settings, message queue, data fetching
│       ├── config.json     # Clay settings UI definition (all user-facing settings)
│       ├── clay-config.js  # Clay custom function: attaches click handlers for test buttons
│       ├── glucose.js      # BG/delta formatters + sendNoGlucoseData (also bundled into the plugin)
│       ├── glucose_plugin.js # Glucose source: subscription to the plugin, modes, watchdog, gate
│       ├── legacy_cleanup.js # Purges Dexcom data older versions left in the face's localStorage
│       ├── weather.js      # OpenWeatherMap API client (current + forecast, smart cache)
│       ├── geolocation.js  # ipgeolocation.io astronomy API client
│       ├── astronomy.js    # Astronomy time calculations (next sun/moon event, phase)
│       └── garbage.js      # Garbage bag schedule computation
├── docs/
│   ├── plugins.md         # Developing plugins for the current app/SDK/tools: sandbox, packaging, testing, pitfalls
│   └── noVNC.md           # Viewing and driving the emulator in a browser
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
│   ├── legacy_cleanup.test.js
│   ├── utils.test.js
│   └── weather.test.js
└── scripts/
    ├── run-emulator.sh        # Convenience wrapper: pebble install --emulator (--pbw for another pbw)
    ├── build-plugin.js        # Bundles src/plugin-src/ into plugin/plugin.js (--check verifies)
    ├── pack-plugin.py         # Builds build/rat-scout.pbw (face, manifestVersion 2) + build/rat-scout-glucose.pbw (plugin)
    ├── plugin-smoke.sh        # Emulator smoke test for the plugin (manual; network blocked)
    ├── device-check.sh        # On-device checklist: install/logs/screenshot over CloudPebble, log analysis
    ├── browser_override.py    # Override browser for Pebble config in Codespaces
    ├── settings.json          # Template for run-emulator.sh --settings
    └── settings.md            # Reference for every settings key
```

## Target Platforms
flint, emery (`package.json` `targetPlatforms`; `pebble build` builds only these).

## Permissions (`usesPermissions`)
Declared per pbw in `pebble.usesPermissions`, for the phone app's plugin-era permission system.

Watchface (`package.json`):

| Permission | Why |
|---|---|
| `Location` | `navigator.geolocation` in `index.js` (astronomy, weather) and `weather.js` |
| `Internet` → `api.openweathermap.org` | `weather.js` |
| `Internet` → `api.ipgeolocation.io` | `geolocation.js` |
| `Glucose` (plugin: `01523c90-aa11-4a82-8e00-58cc3e98472c`) | Reading the Rat Scout Glucose plugin. The user approves it on the phone ("Read your glucose readings (via Rat Scout Glucose)"); until then the subscription gets `PERMISSION_DENIED` |

Plugin (`plugin/package.json`):

| Permission | Why |
|---|---|
| `Internet` → `share2.dexcom.com`, `shareous1.dexcom.com`, `share.dexcom.jp` | Dexcom Share regions (`src/plugin-src/dexcom.js` base URLs) |

- They only take effect when the pbw is marked `manifestVersion: 2` and the user has plugins enabled (Pebble plugins preview guide, "Permissions" and "Declaring": "only in place when plugins are enabled"; "Without that it's a legacy app"). A legacy pbw keeps the old implicit internet + location access.
- `pebble build` alone produces a legacy pbw (see [Build](#build)); only `scripts/pack-plugin.py` output is manifestVersion 2.
- Keep `Internet` limited to domains the JS actually requests. `pebble convert-manifest --dry-run` also lists hosts found in comments and help text (github.com, openweathermap.org, ipgeolocation.io); those are never requested and are deliberately not declared.

## Plugin (preview) — `health/glucose`
**Rat Scout Glucose** is a separate plugin-only pbw (`plugin/`, uuid `01523c90-aa11-4a82-8e00-58cc3e98472c`; Pebble plugins preview, mobile app 1.16.x, disabled by default) that serves the latest Dexcom reading to Rat Scout and any other watchface, app or Index. Category contract (our own; no published `health` category exists yet):

`health/glucose`, one instance, `instanceId: "dexcom"`, `supportsMultiple: false`, `suggestedRefreshIntervalSec: 60`, caller permission `Glucose` (defined by the plugin, kind `read`, label "Read your glucose readings").

| Property | Shapes | Notes |
|---|---|---|
| `name` | shortText | "Dexcom" |
| `status` | shortText, longText | shortText `ok` (longText "Latest reading") on every reading instance; shortText `busy` (longText "Signing in to Dexcom") on an instance that has only `name` and `status`, sent when Dexcom was not called because another run holds the login lock and no reading for these credentials is cached |
| `glucose` | numericValue, shortText, longText | Plugin's units (`ratscout.settings.units`, default mg/dL), formatted by glucose.js `formatBGValue`. numericValue range: mg/dL min 40, max 400; mmol/L min 2.2, max 22.2. Long: value and units ("120 mg/dL"); every shape is the same reading, so the trend stays in `trend` (preview guide, "Shapes") |
| `delta` | numericValue, shortText | User's units, glucose.js `formatBGDelta` ("+5"). Omitted when the reading has no numeric delta (single reading) |
| `glucose_mgdl` | numericValue | Raw Dexcom mg/dL (`unit: "mg/dL"`), no min/max: the lossless value Rat Scout's PKJS reads (it formats in its own Clay `BG_UNITS`) |
| `delta_mgdl` | numericValue | Raw mg/dL delta (`unit: "mg/dL"`). Omitted together with `delta` |
| `trend` | shortText, longText | Arrow (dexcom.js `TREND_ARROWS`, as pydexcom: `None` → empty, `NotComputable` → `?`, `RateOutOfRange` → `-`) and a description |
| `trend_code` | longText | Raw Dexcom `Trend` |
| `reading_time` | timestamp | Epoch seconds |

Answers:
- No login or password set, Dexcom failure, login paused (`badcreds`) → `instances: []`, `validUntilMs` now + 60 s. A failure at the login steps or a failed session clears `accountId`/`sessionId`; a failure after a successful login (no readings, a readings timeout or network error) keeps them, so the next poll reads without logging in (`dexcom_guard.js` `keepsSession`).
- Wrong category/item → `respond.error('INVALID_REQUEST')`; an exception while handling the Dexcom result → `respond.error('UNKNOWN')` (`main.js`), releasing the login lock if this request took it.
- Reading younger than 310 s (cached, same credentials) → served from cache, no Dexcom call; `validUntilMs = max(now + 60 s, (ts + 310) * 1000)`.
- Dexcom is called at most once per 55 s (`ratscout.plugin.lastAttempt`; 55 rather than 60 so jitter in a 60 s poll never skips one).
- Login lock held (younger than 45 s, and not dated in the future), or throttled → cached reading for these credentials if any (any age, same `validUntilMs` rule); else the `busy` instance (`validUntilMs` now + 30 s) while the lock is held, or `instances: []` when the last attempt finished without a reading.

Runtime: a plugin "is started fresh for each request" (preview guide), so all state is in the plugin's localStorage. The plugin has its own uuid, so it shares no localStorage with the watchface and does not read the face's `clay-settings`.

Settings (`src/plugin-src/settings.js`): set on the plugin's own settings page, `plugin/config.html` (`configPage`, bundled in the pbw). The page calls `Pebble.sendMessage('plugin', {type: 'load'|'save'})`, answered by `handleConfigMessage` (`main.js`):
- Login, region and units in the plugin's localStorage (`ratscout.settings.login`, `ratscout.settings.region`, `ratscout.settings.units`); the password in `Pebble.secureStorage` under `dexcom.password`. Region defaults to `ous`, units to `mg/dL`.
- `load` returns `{login, region, units, hasPassword}`: the page never receives the password. An empty password on save keeps the stored one.
- `save` stores and calls `Pebble.refreshSources(['health/glucose'])` (if present). Only when the login, the region or the password changed does it remove `accountId`, `sessionId` and `ratscout.plugin.lastAttempt`, so the new account is tried at once; saving units or the same account again keeps them, so repeated saves can't bypass the 55 s throttle. A new password (different from the stored one) bumps `ratscout.settings.credVersion`.
- `Settings.load` and `Settings.save` run inside a promise chain, so a throwing `secureStorage` still answers the request (`UNKNOWN`) or the page (`ok: false`).

HTTP: `src/plugin-src/dexcom.js` uses XMLHttpRequest; the preview guide documents only `fetch` ("Nothing else"), so the bundle binds `src/plugin-src/xhr_shim.js` as `XMLHttpRequest` in bundle scope (never as a global), and `setTimeout`/`clearTimeout` to the runtime's if present, else no-ops. Phone-side availability of XHR and setTimeout is UNVERIFIED; the emulator has both (`pypkjs/plugins/js_plugin.py` installs Timers and XHRExtension), which is why the shim is used unconditionally.

### Glucose source selection (`src/pkjs/glucose_plugin.js`)
The watchface reads BG only from the Rat Scout Glucose plugin (`PLUGIN_UUID`); it never contacts Dexcom ("plugin only", no direct fallback).

| Mode | Watch shows | Entered when |
|---|---|---|
| `unavailable` | "---" (sent through the gate, `deps.send` type `No glucose data`) | no `Pebble.subscribeToSource`/`enumeratePlugins`, `enumeratePlugins` throws or does not list `PLUGIN_UUID` with `health/glucose`, `subscribeToSource` throws (on start or resubscribe), or see errors below, grace expiry, the stall watchdog |
| `pending` | nothing new yet | `ready`, or a re-check: subscribed with `plugin: PLUGIN_UUID`; grace timer 30 s |
| `plugin` | the subscription's envelopes | any `onData` (empty included: it shows the host is alive), also from `unavailable` while the subscription is kept |

Errors (`onError(err)`, by `err.code` only, missing code = `UNKNOWN`; whether `err.message` carries the plugin's text is UNVERIFIED; the message is logged). Ignored while `unavailable`, except `INVALID_REQUEST`:

| Code | Action |
|---|---|
| `INVALID_REQUEST` | unsubscribe, `unavailable`, pinned (no re-check) |
| message "… was updated or removed; subscribe again" (code `UNKNOWN`) | the phone closed the subscription because it retired the plugin (plugin updated or removed, or the plugin preview turned off; mobileapp `plugin/JsPlugin.kt` `observe()`). Drop it and detect again: still listed → subscribe at once (`pending`, the shown reading stays); not listed → `unavailable`, "---" at once, and the re-check resubscribes later |
| `PERMISSION_DENIED`, `PLUGIN_UNAVAILABLE` | `unavailable`, keep the subscription (the guide: `PERMISSION_DENIED` lasts until the user answers; an error does not end a subscription) |
| anything else while `pending` | `unavailable`, keep the subscription |
| anything else in `plugin` | count (reset by any `onData`); the first keeps the shown reading; `unavailable` at the 2nd consecutive error or if no envelope for more than 11 min |

- **Grace:** still `pending` 30 s after subscribing → `unavailable`.
- **Re-check:** `recheck()` runs at the top of `fetchAllData()` after the stall watchdog, only while `unavailable` without a subscription and not pinned. It repeats the detection and subscribes if the plugin is listed now, e.g. when the user installs the plugin or turns the preview on while the face runs. Detection is a local `enumeratePlugins()` call, so a re-check on every watch ping costs nothing; a re-check that still finds nothing logs and sends nothing.
- **Overdue refresh:** `refreshIfOverdue(now)` runs in `fetchAllData()` after the re-check. In `plugin` mode with a subscription and a reading, when that reading is more than 305 s old (`READING_DUE_SEC`, as the watch's `ts + 305`), no envelope arrived in the last 55 s after the plugin's cache went stale (`ts + 310`, `PLUGIN_FRESH_SEC` = `main.js` `READING_FRESH_SEC`; an earlier envelope was a cached answer, which on the phone held a reading back a minute) and the last resubscribe was at least 55 s ago (`RESUBSCRIBE_MIN_MS`, the plugin's Dexcom throttle; `onSettingsChanged` counts too), it unsubscribes and subscribes again (`Glucose plugin: resubscribe (reading overdue N s)`). The watch pings every minute while the reading is overdue, up to 600 s after it (see Gate). The phone host reads at once on a new subscription, while its own poll waits 60 s of *awake* time, which took about 6 min on the phone (docs/plugins.md §6.1). The mode, the gate and `lastPluginOkMs` are untouched, so a repeat of the shown reading is skipped and the stall watchdog still counts from the last real envelope; no grace timer starts; errors on the new subscription follow the table above. Callbacks of a replaced subscription are ignored (a generation counter set before subscribing). Never in `pending` or `unavailable`, before the first reading, or after `INVALID_REQUEST`. Dexcom load stays bounded by the plugin: a cached reading younger than 310 s is served without a call, and at most one call per 55 s otherwise (`test/plugin.test.js` "frequent requests").
- **Stall watchdog:** `checkStall(now)` at the top of `fetchAllData()` (runs on `ready`, `webviewclosed` and every watch ping, at least every 5 min, `rat_scout.c` tick handler). In `plugin` mode with no envelope for more than 11 min → `unavailable` (subscription kept). A later envelope returns to `plugin`. An old reading timestamp alone (sensor gap) never triggers it.
- **Envelope → watch:** an instance with `glucose_mgdl` + `reading_time` becomes `{current: {_value, _delta: delta_mgdl or null, _datetime}}` passed to `Glucose.buildGlucoseDictionary`, formatted in the face's Clay `BG_UNITS` (no mmol round trip). `status: busy` sends nothing (the watch keeps its value). Anything else sends `"---"` with `TIMESTAMP 0`.
- **Gate:** every glucose dictionary (plugin data and `unavailable`'s "---") goes through one gate; one whose `BG` and `TIMESTAMP` equal the last sent is dropped (`Glucose gate: skipped duplicate ts=…`), which stops repeat host refreshes. Catch-up polling still works: every glucose message sets `s_next_fetch_time = ts + 305` (`messaging.c`); from then the watch pings every minute until `ts + 600` (`OVERDUE_PING_WINDOW_SECONDS`, `rat_scout.c` tick handler), then every 5 min (`FALLBACK_FETCH_MINUTES`) until a newer reading arrives. Watch pings drive the re-check, the watchdog and the overdue refresh. Alerts fire only on a zone change (`glucose.c`, `new_zone != s_bg_zone`).
- **Settings saved:** `onSettingsChanged()` clears the gate and resubscribes, so the next envelope is re-formatted and sent (`BGDELTA`/`BG_SHOW_TIMEDELTA` only arrive in glucose messages, `messaging.c`). The host reads at once on a new subscription: mobileapp `plugin/JsPlugin.kt:124-135` requests before its first wait (pypkjs `plugins/base.py` `observe()` does the same), and on the phone the resubscribe delivered within about 1 s.
- **Legacy cleanup:** on `ready`, `src/pkjs/legacy_cleanup.js` removes `DEX_LOGIN`, `DEX_PASSWORD`, `DEX_REGION` from the face's `clay-settings` (Clay keeps stored keys otherwise) and the old session, cache and guard keys (`accountId`, `sessionId`, `ratscout.plugin.*`, `ratscout.auth.*`) that versions fetching Dexcom in the face left there. Unit-tested only (`test/legacy_cleanup.test.js`); its phone log line was not captured.
- All watch messages still go through `sendToPebble()`.

### Plugin pbws
- `python3 -I scripts/pack-plugin.py` checks the bundle (`build-plugin.js --check`), runs `pebble clean` + `pebble build` (skipped with `--no-build`), then writes:
  - `build/rat-scout.pbw`: the watchface, `pebble build` output with `manifestVersion: 2` (a watchapp needs it to read plugins; preview guide, "Writing a watchface or app that uses plugins"), no plugin. Copied unchanged if already manifestVersion 2.
  - `build/rat-scout-glucose.pbw`: plugin-only, from `plugin/` without the SDK: `appinfo.json` built from `plugin/package.json` (as upstream `pack-plugin-pbw.py` does: `manifestVersion` 2, names, `watchapp.watchface: false`, empty resources), plus `plugin.js` and `config.html` (a URL `configPage` is not bundled).
  - `build/<dir>.pbw` stays the legacy watchface, which can't read plugins.
- Validation mirrors PR #2483 and pypkjs 3.0.3 `plugins/manifest.py`: permission name alphanumeric starting with a letter and not `InvokeAction`, a label, `kind` in `read`/`write`/`exfiltrating`. The preview guide also lists `dangerous`; neither validator accepts it, so we use `read`.
- Upstream `pack-plugin-pbw.py` is not used: it opens `build/<package name>.pbw` (`build/Rat Scout.pbw`), while `pebble build` names the pbw after the directory; and the pebble-apps repo (formerly pebble-plugins) still has no LICENSE (checked 2026-11-01).
- No published SDK contains PR #2483 (merged 2026-10-19): `sdk.repebble.com/v1/files/sdk-core` lists up to 4.33.1, and PebbleOS releases ship only firmware and QEMU images. When one appears, the packer detects a manifestVersion 2 watchface and copies it unchanged.

### Verification status
Emulator = pebble-tool 5.1.1 (Python 3.13) / pypkjs 3.0.3 on flint, via `scripts/plugin-smoke.sh` (all checks pass with the two-pbw split: no-account, cached-reading, network-blocked, no-plugin). Phone = Pebble app 1.16.0.5 (Android, beta channel) with a flint, plugin preview on, via `scripts/device-check.sh` over CloudPebble (2026-11-01; Dexcom had no current reading during these runs, so only the "---" path was exercised on the phone); `scripts/device-check.sh steps` lists the on-device checklist (README, "Plugin check on a real phone").

Until 2026-11-01 the plugin was embedded in the watchface pbw (`src/plugin/index.js`, `build/rat-scout-plugin.pbw`), shared the face's localStorage and `clay-settings`, and the face fell back to fetching Dexcom directly. Rows marked "(embedded design)" were verified then and still apply to the plugin's runtime; the face's direct path no longer exists.

Log lines the checks rely on (PKJS): `Glucose source: mode=<mode>`, `Glucose plugin data: N instance(s)`, `Glucose plugin error: <code>`, `Glucose gate: plugin send|skipped duplicate ts=<TIMESTAMP>`, `<type> sent to Pebble successfully`; plugin: `No Dexcom account set on the Rat Scout Glucose settings page`, dexcom.js `Getting account ID...`, `Session ID received`, `Fetching glucose readings...`. pebble-tool tags plugin output `plugin>` (`pebble_tool/util/logs.py` `PLUGIN_LOG_MARKER`). Lines the face logs at `ready` can precede the log stream (smoke test and phone), so no check relies on them.

| Item | Status |
|---|---|
| SDK 4.33.1 behaviour described in [Build](#build) | Verified (clean builds; bogus `kind` builds) |
| A published SDK with plugin support | None on 2026-10-30 (SDK server lists up to 4.33.1; PebbleOS releases ship firmware/QEMU only) |
| Host loads the plugin-only pbw; the face reads it across uuids | Emulator-verified (`pypkjs/runner/__init__.py` `_load_plugin`; smoke cases no-account, cached-reading, network-blocked). Phone-verified: the plugin's page lists only the three Dexcom domains; the face subscribed and reached `mode=plugin` |
| Face without the plugin installed | Emulator-verified (case no-plugin: `unavailable`, "---", no subscription, no Dexcom request) |
| Detection, `pending` → `plugin`, envelope → watch, gate, host refresh every 60 s | Emulator-verified (screenshot of case cached-reading shows 6.7 +0.3 from a seeded 120/+5 mg/dL). Phone-verified, split design, 2026-11-02 with live readings: a new reading fetched by the plugin and sent once (repeats skipped by the gate, cached answers between readings with no Dexcom call); the watch showed 10.5 mmol/L −0.4. Earlier the empty-reading envelope: "---" sent once. The phone re-read about every 60 s, with occasional gaps of several minutes |
| 30-minute run, live readings | Phone-verified 2026-11-02 (25 min in `plugin` mode): 4 Dexcom reading requests and no logins for 4 new readings, each sent once (a Clay settings close re-sent the current one on purpose), no errors, no crashes. Delay from Dexcom reading time to the watch 1–5 min; one reading skipped because the phone did not poll the plugin for about 6 min, three times (12:07→12:13, 12:13→12:19, 12:24→after 12:30), although `suggestedRefreshIntervalSec` is 60. The host's poll timeout counts only awake time (Android `SystemClock`: `System.nanoTime`, `Object.wait` and `Handler` stop in deep sleep; mobileapp `plugin/JsPlugin.kt:132`, `di/LibPebbleModule.kt:354`); that this caused the gaps is a hypothesis consistent with the log (docs/plugins.md §6.1) |
| Overdue refresh (`refreshIfOverdue`) and minute pings while overdue | Phone-verified 2026-11-02, 30-minute run (15:35–16:05 UTC, same phone, app 1.16.0.5, flint): 6 new readings, none skipped, delay from Dexcom reading time to the watch 24, 51, 57, 55, 56 and 117 s (baseline run: 115, 298, skipped, 54, 55 s). 4 overdue resubscribes, each answered within 1 s with a Dexcom read; 6 reading requests and no logins for 6 readings; no errors, no resends. The host's own polls stayed irregular (none 15:49:02→15:54:01). The 117 s case: a cached host answer at 16:03:09 (6 s before the reading was due in the plugin) blocked the resubscribe at the 16:04:01 ping (envelope less than 55 s ago); the 16:05:02 ping resubscribed; fixed since (only envelopes after `ts + 310` count). Re-run with the fix, 16:32–17:02 UTC, no disconnect: 6 new readings, none skipped, delay 55, 55, 56, 53, 56, 56 s; each found by the resubscribe at the first due ping (6 resubscribes, answered within 1 s); 6 reading requests and no logins for 6 readings; no errors, no resends; the host's own polls stopped after 16:37. The remaining ~55 s is the watch's due time (`ts + 305`) rounded up to the next minute tick, not the host. The minute pings while overdue (part B) were never needed in either run, so they are still unverified on the phone |
| Clay units/delta change in plugin mode | Phone-verified: switching to mg/dL and turning the delta off re-sent the current reading at once (189 mg/dL, no delta), without waiting for the next reading |
| Plugin preview turned off while the face runs | Phone-verified: the phone closed the subscription with `UNKNOWN ("Rat Scout Glucose was updated or removed; subscribe again")`. The face first treated it as a soft error and kept the last reading until the 11 min watchdog showed "---" (12 min); it now detects again at once on that message. Phone-verified after the fix: "---" about 40 s after the preview was turned off (the phone notices a retired plugin at its next poll, at most `suggestedRefreshIntervalSec` later); turning the preview back on, the next watch request resubscribed and a live reading reached the watch 1 s later |
| Plugin settings page (`configPage`, `Pebble.sendMessage('plugin', …)`) | Phone-verified (1.16.0.5): loaded, saved, and on reload showed the login, "Saved (leave empty to keep)" for the password, and the chosen units |
| Password from `Pebble.secureStorage` | Emulator-verified (seeded `plugin-secure-storage/<uuid>.json`; case network-blocked tried to log in). Phone-verified: the plugin logged in with the stored password and answered (no current reading, so "---") |
| Plugin storage separate from the face's | pypkjs keys a plugin's store off the pbw uuid (`js_plugin.py`); the smoke test seeds each uuid's store separately. Phone: not inspected directly; the face no longer reads any Dexcom key |
| Shim on fetch, including a rejected fetch at the account step | Emulator-verified (case 3: "Network error fetching account ID" → "---", no login pause) |
| `XMLHttpRequest` / `setTimeout` in the phone's plugin runtime | Phone-verified: **not available, and touching them throws.** Android runs plugins in a WebView whose `LOCKDOWN_JS` turns `setTimeout`, `clearTimeout`, `XMLHttpRequest`, `window`, `self` and more into throwing getters (mobileapp `libpebble3/.../js/JsEngine.android.kt`); `typeof` does not guard against them, and `evaluateJavascript` swallows the error, which showed as `PLUGIN_UNAVAILABLE (no source handler registered)`. The bundle probes host globals inside try/catch (`scripts/build-plugin.js`); `test/helpers/plugin_host.js` applies the same lockdown. The fetch shim works on the phone |
| `fetch` accepting `User-Agent` | Not needed: dexcom.js sends no custom User-Agent (pydexcom's recorded traffic works with the client default) |
| `onError` paths (`PERMISSION_DENIED`, `TIMEOUT`, ...) | Unit tests only. The emulator logs a plugin's `respond.error` and skips it instead of calling `onError` (`js_plugin.py` `_parse_envelope`), grants every caller permission (`javascript/plugins.py`), and `pebble emu-permission` only knows `WatchMicrophone` |
| The face's `Glucose` permission on the plugin | Phone-verified: the face got `PERMISSION_DENIED (… waiting for approval of <uuid>:Glucose)` until the user approved, then `mode=plugin` |
| `enumeratePlugins` with plugins disabled, or on app < 1.16 | Phone-verified (1.16.0.5, embedded design) with the preview off: the plugin is not listed (mobileapp `LockerPluginLoader` registers plugins only while `enablePlugins` is on); the face now shows "---" (`unavailable`). App < 1.16: UNVERIFIED |
| Clay's `openURL` settings page in a manifestVersion 2 pbw | Phone-verified (1.16.0.5, preview on, embedded design): opens and saves |
| Legacy purge (`legacy_cleanup.js`) on `ready` | Unit tests only (`test/legacy_cleanup.test.js`): its log line was not captured on the phone because the log stream started after `ready` |
| Phone host reading immediately on (re)subscribe | Phone-verified: first envelope within about 1 s on subscribe, and after a Clay settings change (resubscribe) |
| Phone dropping undeclared shapes | Not exercised (emulator does not validate); `test/plugin.test.js` keeps every shape declared |
| How Dexcom reports a wrong password | Secondary source: pydexcom's recorded Dexcom traffic (`tests/cassettes`, 2025-04-19) shows HTTP 500 `{"Code":"AccountPasswordInvalid"}` at both login steps; pydexcom also maps `SSO_InternalError` "Cannot Authenticate by AccountName/AccountId" and the lockout code `SSO_AuthenticateMaxAttemptsExceeded` (`dexcom.py` `_handle_error_code`). Never tried by us |
| Lockout/rate-limit thresholds and duration; whether a new login invalidates older sessions | UNVERIFIED, permanently: never tested against the real service |
| Atomicity of localStorage between concurrent plugin runs | UNVERIFIED; the guard is best-effort |
| Re-check: preview turned on while the face runs | Phone-verified (embedded design): on the next watch request the face subscribed and reached `plugin` within 1 s, no face switch. Split design: re-check from `unavailable` is unit-tested; on the phone it is step 3 of `device-check.sh steps` |
| Plugin logs over the developer connection | Phone-verified: `plugin>` lines arrive through CloudPebble (mobileapp `plugin/PluginLogs.kt`) |
| The Dexcom session kept while no reading exists | Phone-verified (embedded design): one login, then reading requests only, next poll after 60 s. The session used to be dropped on every failure, which meant a full login per poll |

### Plugin storage keys
The plugin and the face have different uuids, so each has its own localStorage; nothing is shared.

Plugin (Rat Scout Glucose):

| Key | Writer | Contents |
|---|---|---|
| `ratscout.settings.login`, `ratscout.settings.region`, `ratscout.settings.units` | settings page (`settings.js`) | Dexcom login, region (`ous`/`us`/`jp`), units (`mg/dL`/`mmol/L`) |
| `ratscout.settings.credVersion` | settings page | Counter bumped when a new password is saved (absent = 0); part of `credKey` |
| `dexcom.password` (in `Pebble.secureStorage`, not localStorage) | settings page | Dexcom password; never returned to the page |
| `accountId`, `sessionId` | plugin | Dexcom session; removed on settings save |
| `ratscout.plugin.lastReading` | plugin | `{credKey, value, delta, trend, arrow, ts}`, raw mg/dL |
| `ratscout.plugin.lastAttempt` | plugin | Epoch ms of the last Dexcom call; removed on settings save |
| `ratscout.auth.inflight` | plugin | `{owner, at}` login lock, TTL 45 s |
| `ratscout.auth.badcreds` | plugin | `{credKey, until}`: no login for 15 min after a refused login (60 min after Dexcom's lockout answer), unless the credentials change |
| `ratscout.auth.sessionCredKey` | plugin | credKey of the stored session; a mismatch forces a new login (no key = trusted) |

`credKey` is a djb2 hash of `login|region|credVersion`: a change detector, not security. It holds nothing derived from the password (before 2026-11-02 it hashed the password; the first run after the update sees a different key and logs in once). A login pause (`badcreds`) longer than 60 min means the clock went back and is cut to 60 min from now; a login lock dated in the future is ignored.

Watchface: `clay-settings` (Clay; no Dexcom fields) and the weather/astronomy cache keys (`index.js` `CONFIG`). On `ready`, `legacy_cleanup.js` deletes `DEX_LOGIN`/`DEX_PASSWORD`/`DEX_REGION` from `clay-settings`, and the session/plugin/guard keys above if an older version left them in the face's store.

### Login guard (`src/plugin-src/dexcom_guard.js`)
- Used by the plugin only (owner `plugin`); the watchface no longer logs in to Dexcom. The lock still guards against overlapping plugin runs.
- A login is needed when there is no usable session. Before it: skip if `badcreds` matches, or if a lock younger than 45 s exists; otherwise take the lock. The lock is released (by its owner only) in both outcomes.
- Rejections, mapped by dexcom.js `loginErrorMessage()` from the login steps' HTTP 500 `{Code, Message}` body (codes as in pydexcom):
  - `Invalid credentials`: `AccountPasswordInvalid`, `SSO_InternalError` "Cannot Authenticate by Account…", or a zero account GUID. 15 min pause.
  - `Login failed`: zero session GUID. 15 min pause.
  - `Max authentication attempts exceeded`: `SSO_AuthenticateMaxAttemptsExceeded`, Dexcom's own lockout answer. 60 min pause (`LOCKOUT_PAUSE_MS`), since the lockout's duration is unknown.
- Everything else is transient and never pauses: other HTTP errors (`Error fetching account|session ID: <status>`), network errors and timeouts. They retry at the plugin's normal cadence (throttle 55 s, host poll about every 60 s), the rate the face's old direct path ran against Dexcom for over a year.
- Both login steps time out after 15 s (`src/plugin-src/dexcom.js`), so a login takes at most about 30 s, inside the 45 s lock. In the plugin the timeout needs `setTimeout` (UNVERIFIED on the phone); without it the host's request TIMEOUT is the bound.
- Session-error re-authentication inside dexcom.js is not guarded (one re-login per run, as pydexcom).
- Dexcom's lockout and rate-limit thresholds are permanently UNVERIFIED: wrong passwords and failed logins are never tried against the real service. The guard is deliberately conservative and verified only by unit tests with a mocked fetch (`test/dexcom_guard.test.js`, `test/helpers/plugin_host.js`).

### Build
- `node scripts/build-plugin.js` regenerates `plugin/plugin.js` from `src/plugin-src/main.js` and its requires (`src/pkjs/glucose.js` included; modules in a small IIFE module table); `--check` fails if it is stale, and `test/plugin.test.js` checks the same.
- SDK 4.33.1 copies the whole `pebble` block, including `usesPermissions`, into `appinfo.json` (after a clean build: the bundle step does not track appinfo changes) but sets no `manifestVersion`, adds no plugin files, has no plugin-only projects, and does not validate `definesPermissions` (a bogus `kind` builds fine). So `pebble build` alone produces a legacy watchface pbw (`build/<checkout dir>.pbw`); `scripts/pack-plugin.py` makes both plugin-era pbws ([Plugin pbws](#plugin-pbws)).
- Toolchain: pebble-tool 5.1.1 on Python 3.13, SDK 4.33.1. pebble-tool and the SDK venv must share a Python minor version (README, "Building").

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
  Pebble ready → purgeLegacyDexcomData() → getSettings() → sendSettings() → glucoseSource.start() → fetchAllData()
  webviewclosed → clay.getSettings() → sendSettings() → glucoseSource.onSettingsChanged() [then test command if flagged]
  plugin subscription onData → envelope → gate → MSG_TYPE_GLUCOSE (switches the mode to plugin)
  plugin onError / 30 s grace expiry / stall → unavailable → "---" through the gate (INVALID_REQUEST also unsubscribes)

  fetchAllData():
    glucoseSource.checkStall()
    glucoseSource.recheck()       → subscribe if the plugin appeared (unavailable, no subscription)
    glucoseSource.refreshIfOverdue() → resubscribe if the reading is overdue (plugin mode, at most once per 55 s)
    fetchAndSendWeather()         → MSG_TYPE_WEATHER  (cached per interval)
    fetchAndSendAstronomy()       → MSG_TYPE_ASTRONOMY (cached daily)

Plugin (Rat Scout Glucose, started fresh per request):
  source request → Settings.load() → cache / throttle / guard → Dexcom → envelope (validUntilMs)
  settings page → Pebble.sendMessage('plugin', load|save) → handleConfigMessage → Pebble.refreshSources on save

Watch C:
  ready → main_window_load → overlay_init (last, top z-order)
  tick_handler (every minute):
    → update_time, update_delta_display, update_steps (every 5 min)
    → hourly vibe + sound + overlay_show at tm_min==0 (each gated by its own toggle)
    → outbound ping to trigger JS fetch when s_next_fetch_time reached (reading ts + 305 s),
      then every minute until ts + 600 s, then every 5 min (tm_min % 5) until a newer reading
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
1. Glucose (text only: the Dexcom account is set on the Rat Scout Glucose plugin's settings page)
2. Blood Glucose (units, show delta, show time delta, BG vibe, low/high sounds, thresholds, night thresholds + window)
3. Watchface (date format, hourly vibe, hourly sound)
4. Weather (OWM API key, units, update interval)
5. Astronomy (ipgeolocation.io API key)
6. Garbage Collection (pickup hour, organic/grey/black days)
7. Quick View Alerts (enable toggle, duration select: 3/10/20 s, test button → MSG_TYPE_OVERLAY_TEST)
8. Vibration Test (3 buttons → MSG_TYPE_VIBE_TEST)
9. Sound Test (3 buttons → MSG_TYPE_SOUND_TEST)

Key-by-key reference: `scripts/settings.md`.
