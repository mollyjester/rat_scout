# Developing Pebble plugins (preview, November 2026)

A practical guide to building a phone-side **plugin** and a watchface that consumes it, for the
versions available on 2026-11-01. It complements the official guide with what we learned
building Rat Scout's `health/glucose` plugin and running it on a real phone.

> **Preview.** The API will change. Don't publish apps that use or offer plugins to the
> appstore; publishing plugins is limited to invited developers. Sideload only.

Every statement here is either cited (official guide, upstream source with file and line) or
was observed on a device. Anything else is marked **UNVERIFIED**.

## 1. Versions

| Component | Version used | Notes |
|---|---|---|
| Pebble mobile app | **1.16.0.5**, Android (beta channel) | The preview needs 1.16.x. Turn it on in **Settings → Plugins → Plugins / permissions preview** (off by default). iOS: UNVERIFIED |
| Official guide | `developer.repebble.com/guides/plugins/preview`, updated 2026-10-30 | Describes app 1.16.0.5; items marked **Next release** aren't in it yet |
| pebble-tool | **5.1.2** (PyPI) | 5.1.0+ is required. Run it on the same Python minor version as the SDK venv (3.13 here), or `pebble build` fails with "SRE module mismatch" |
| pypkjs (emulator JS) | **3.0.3** | Has a plugin host: see §8 for how it differs from the phone |
| Pebble SDK | **4.33.1** | The newest on `sdk.repebble.com`. It **cannot build a plugin pbw**; see §7 |
| Watch firmware | not involved | Plugins run only on the phone; a watch-side (C / Alloy) API is listed under the guide's "Future". The watchapp reaches its plugin's data through PKJS and AppMessage, so normal SDK 4.33.1 watch APIs apply |
| Examples | `github.com/coredevices/pebble-apps` | Renamed from `pebble-plugins` (the old URL redirects). No LICENSE file as of 2026-11-01 |
| Phone app source | `github.com/coredevices/mobileapp` @ `dbc937e` (2026-10-30) | Cited below. It may be ahead of 1.16.0.5 |

## 2. The model in one page

Taken from the official guide.
- **What a plugin is:** JavaScript in a `.pbw` that runs **inside the Pebble app on the phone**.
- **Sources:** data any watchface, watchapp or the Index assistant can read. Addressing goes `category/item` → instances (stable `instanceId`) → properties → **shapes**.
- **Actions:** operations with JSON-Schema arguments that other apps or Index can invoke.
- **Shapes:** `shortText` (about 7 characters), `longText`, `numericValue` (`value`, `unit`, optional `min`/`max`), `timestamp` (epoch seconds), `boolean`, `icon` and `image` (4-bpp palettised, only when the request asks for `iconPixelSize`), plus `series.<shape>`.
  - **Every shape of a property must be the same reading.** Rat Scout's `glucose.longText` is "120 mg/dL", not "120 mg/dL →": the trend is its own property.
- **How a source is chosen:** apps ask for a category and item, not a plugin. The phone serves the user's preferred plugin. To use your own, pin it with `plugin: "<your uuid>"`.
- **Defining a category:** names are free-form. If an existing category fits, reuse its names; otherwise define your own and document it, as Rat Scout does for `health/glucose`.
- **Lifetime:** a plugin **runs only when needed** (a subscription, an action, or its open settings page), starts fresh for every request, and keeps state in `localStorage`, which it shares with your PKJS.

## 3. One pbw or two?

A plugin can ship inside a watchapp's pbw or as a **plugin-only** pbw. Rat Scout started with one
pbw and split it in two; the split is what we recommend for a data plugin.

- **Permissions belong to the pbw, not to the plugin.** One `usesPermissions` list covers the
  app's PKJS and its plugin (guide: "Declare what your app and its plugin need once"). With one
  pbw, the phone shows the union on one page, so the plugin also holds the face's domains and
  location, even if it never uses them. With two pbws, each page lists only its own needs: Rat
  Scout Glucose shows just the three Dexcom domains, and the face shows weather, location and
  "Read your glucose readings (via Rat Scout Glucose)".
- **Two pbws share no storage.** `localStorage` is shared only between a plugin and the PKJS
  of the *same* pbw (same uuid). After the split the plugin can't read the face's Clay settings,
  so it needs its own settings page (§5.3), which is the right place for credentials anyway.
- **The consumer declares the provider's permission by uuid**:
  `{ "name": "Glucose", "plugin": "<plugin uuid>" }`. On first use the phone holds the
  subscription with `PERMISSION_DENIED … waiting for approval of <uuid>:Glucose` until the user
  approves, then serves it. Pin the provider with `plugin: "<plugin uuid>"` when subscribing.
- **Install order doesn't matter** if the consumer re-checks for the plugin periodically (§6).
- **Sideloaded plugins have no icon.** The Plugins tab draws `listImageUrl`, which only appstore
  entries carry (mobileapp `pebble/.../ui/LockerUtil.kt:496`); a sideloaded pbw gets none
  (`disk/pbw/PbwApp.kt` `toLockerEntry`). The icon comes from the store listing
  (`pebble publish --icon-small/--icon-large`), so it can't be tested while publishing is closed.

## 4. Manifests

The plugin-only pbw (`plugin/package.json` in Rat Scout):

```json
"pebble": {
  "displayName": "Rat Scout Glucose",
  "uuid": "<plugin uuid>",
  "projectType": "plugin",
  "configPage": "config.html",
  "usesPermissions": [{ "name": "Internet", "parameters": { "domains": ["share2.dexcom.com", "shareous1.dexcom.com", "share.dexcom.jp"] } }],
  "plugin": {
    "description": "Read by Index too: say what the data is.",
    "script": "plugin.js",
    "definesPermissions": [{ "name": "Glucose", "label": "Read your glucose readings", "kind": "read" }],
    "sources": [{
      "category": "health", "items": ["glucose"],
      "properties": { "glucose": ["numericValue", "shortText", "longText"], "reading_time": ["timestamp"] },
      "callerPermissions": ["Glucose"],
      "supportsMultiple": false,
      "suggestedRefreshIntervalSec": 60
    }]
  }
}
```

The consuming watchface (`package.json`) declares only what it uses, plus the provider's permission:

```json
"usesPermissions": [
  "Location",
  { "name": "Internet", "parameters": { "domains": ["api.openweathermap.org"] } },
  { "name": "Glucose", "plugin": "<plugin uuid>" }
]
```

- **`manifestVersion: 2`** in `appinfo.json` is required on both sides. Without it the pbw is a "legacy app": `enumeratePlugins()` returns nothing and every request fails with `PERMISSION_DENIED`. SDK 4.33.1 doesn't write it (§7).
- **Declare every domain the app uses,** PKJS's as well as the plugin's. When the user turns the preview on, the permission system applies to the whole app.
- **Your own plugin's permission:** on the phone, `{ "name": "Glucose", "plugin": "<own uuid>" }` showed up as "Read your glucose readings (via Rat Scout)" and was granted. A pbw installed under a *new* uuid answered `PERMISSION_DENIED … waiting for approval` until the user approved it. Whether leaving the declaration out breaks things is UNVERIFIED.
- **`kind`:** the guide lists `read`, `write`, `exfiltrating` and `dangerous`. The SDK validator in PebbleOS PR #2483 and pypkjs `plugins/manifest.py` accept only the first three. Use `read` for read-only data.
- **Declare every shape you emit.** The phone drops undeclared shapes (guide). Next release: undeclared *property names* in a request are dropped too.
- **`configPage`** (a bundled settings page) replaces the legacy `showConfiguration` flow when it's set. Clay keeps working if you don't set it: on 1.16.0.5 Rat Scout's Clay page opened and saved in a manifestVersion 2 pbw.

## 5. Writing the plugin script

```js
Pebble.registerSourceHandler(function (request, respond) {
  // request: { category, item, properties?, iconPixelSize? }
  if (request.category !== 'health' || request.item !== 'glucose') return respond.error('INVALID_REQUEST');
  return load().then(function (r) {
    respond.data({ validUntilMs: Date.now() + 60000, instances: [ /* ... */ ] });
  });
});
```

### 5.1 The Android sandbox (the most important section)

On Android the plugin runs in a **WebView**. Before your script runs, the app evaluates
`LOCKDOWN_JS`, which replaces dozens of browser globals with getters that **throw**
`"<name> is not available to plugins"` (mobileapp `libpebble3/src/androidMain/.../js/JsEngine.android.kt:143`).
The list includes:

`setTimeout`, `setInterval`, `clearTimeout`, `clearInterval`, `XMLHttpRequest`, `WebSocket`,
`window`, `self`, `document`, `navigator`, `localStorage`, `fetch`, `Image`, `location`, …

The host then installs its own `fetch`, `WebSocket`, `localStorage`, `navigator.geolocation`,
`console` and `Pebble` (`plugin/JsPlugin.kt:315-326`). Consequences:

- **No timers and no XHR at all.** Shared PKJS code that uses them needs an adapter. Rat Scout bundles an XHR-on-`fetch` shim with no-op timers (`src/plugin-src/xhr_shim.js`).
- **`typeof setTimeout` throws.** `typeof` only guards *unresolvable* names, not a getter that throws. A feature check at the top of your script kills it.
- **The failure is silent.** `evaluateJavascript` swallows the exception: no log, no error. Every request is then answered `PLUGIN_UNAVAILABLE` with the message "no source handler registered", because the handler was never registered. That's exactly what Rat Scout's first phone run showed.
- **Probe host globals only inside `try/catch`**, outside your module code:
  ```js
  (function (hostFetch, hostSetTimeout) { /* bundle */ })(
    (function () { try { if (typeof fetch === 'function') return function (u, o) { return fetch(u, o); }; } catch (e) {} return null; })(),
    (function () { try { if (typeof setTimeout === 'function') return function (f, ms) { return setTimeout(f, ms); }; } catch (e) {} return null; })());
  ```
- **Don't read globals through `this`** either. The phone evaluates the script as plain code (`engine.eval(script())`), but `this`-based access fails under strict or wrapped evaluation, and it touches the throwing getters anyway.
- **The emulator does NOT apply this lockdown** (§8). Code that passes there can still die on the phone. Simulate it in your unit tests: Rat Scout's `test/helpers/plugin_host.js` defines the same throwing getters before loading the bundle.

The lockdown comment says it exists so that scripts fail on Android the same way they would on
iOS's JavaScriptCore. iOS itself wasn't tested.

### 5.2 Runtime facts

- **Fresh per request:** keep nothing in variables between runs. Use `localStorage`. It is shared with the PKJS of the same pbw only (seen in the emulator and on the phone); a plugin-only pbw has its own.
- **Credentials:** use `Pebble.secureStorage` (`await getItem/setItem/removeItem`), which only the plugin can read. Fill it from the plugin's own settings page (§5.3). Rat Scout keeps the Dexcom password there and the login, region and units in `localStorage`.
- **One self-contained file.** The packager copies `plugin.script` into the pbw unchanged: there's no `require()` and no bundler (PR #2483). Rat Scout concatenates its modules into a small IIFE module table (`scripts/build-plugin.js`) and commits the result.
- **`console.log` shows in `pebble logs`** as `plugin>` lines. The phone streams them to the developer connection (`plugin/PluginLogs.kt`), and they also arrived through CloudPebble.
- **Return data, not errors, for "no data".** Keep `respond.error` for real faults; an empty `instances: []` keeps the caller's subscription healthy.
- **Keep sessions across runs.** Store login tokens in `localStorage` and drop them only on a login or session failure. Rat Scout first cleared them on *any* failure, so every 60 s poll became a full login while Dexcom had no reading.
- **Polling cadence:** while something is subscribed the host calls your handler about every `suggestedRefreshIntervalSec` ("may change"), but that interval counts only time the phone is awake, so it can stretch to minutes (§6.1). On the phone (60 s requested) we saw 60 s right after subscribing and gaps of about 6 minutes later, which skipped a 5-minute Dexcom reading. Don't promise subscribers fresher data than that, and use your own throttle and cache for an upstream API you must not hammer.

### 5.3 A settings page for the plugin

Set `configPage` to an HTML file in the project; it's bundled in the pbw. On the phone it opens
from the plugin's page ("Settings") as "App Settings — Configuring <name>", and talks to the
plugin while it's open (Rat Scout: `plugin/config.html` and `handleConfigMessage` in
`src/plugin-src/main.js`, both verified on 1.16.0.5):

```js
// page: wait for the plugin, then ask it
Pebble.addEventListener('ready', function (e) { if (e.target === 'plugin') load(); });
Pebble.sendMessage('plugin', { type: 'load' }).then(function (s) { /* fill the form */ });
// plugin
Pebble.registerConfigHandler(function (message, respond) { /* respond({ ... }) */ });
```

- **Never send a secret back to the page.** Return `hasPassword: true` and treat an empty
  password field as "keep the stored one".
- **After saving,** drop whatever depended on the old settings (sessions, throttles) and call
  `Pebble.refreshSources(['health/glucose'])` so subscribers get fresh data.
- **Bundle everything the page needs.** A page may only load from the plugin's declared
  domains: no CDNs, inline CSS/JS.

## 6. Consuming a plugin from PKJS

```js
var list = Pebble.enumeratePlugins();          // synchronous: [{ uuid, name, sources: [{ category, items }] }]
var sub = Pebble.subscribeToSource({
  category: 'health', item: 'glucose',
  plugin: PLUGIN_UUID,                         // pin the provider; omit to get the user's preferred one
  onData: function (envelope) { /* envelope.instances[...].properties */ },
  onError: function (err) { /* err.code, err.message */ }
});
```

What we saw on Pebble app 1.16.0.5:

| Situation | What PKJS sees |
|---|---|
| Legacy pbw (no `manifestVersion: 2`) | The guide: `enumeratePlugins()` returns nothing for a legacy app |
| Preview **off** | Plugin not listed (`LockerPluginLoader.kt:40` registers plugins only while `enablePlugins` is on) |
| Preview on, plugin fine | First envelope about 1 s after subscribing |
| Plugin script failed to load or register | `PLUGIN_UNAVAILABLE` "no source handler registered", repeated every refresh |
| Permission not yet approved (a new app, or a new provider uuid) | `PERMISSION_DENIED` "… is waiting for approval of `<uuid>`:`<permission>`", then data once the user approves |
| Provider pbw not installed | Not listed: Rat Scout shows "---" and re-checks |
| Plugin retired while subscribed (plugin updated or reinstalled, or the preview turned off) | `onError` with code `UNKNOWN`, message "`<name>` was updated or removed; subscribe again", and **the subscription is closed** (mobileapp `plugin/JsPlugin.kt` `observe()`). Detect again and resubscribe; no further data comes on the old one. The phone checks at its next poll, so this arrives up to `suggestedRefreshIntervalSec` after the change (about 40 s here) |

- **Log `err.message` as well as `err.code`.** The message is what tells "no plugin" apart from "no handler".
- **An error doesn't end a subscription** (guide), so keep it alive. Rat Scout's modes are `unavailable` (shows "---") / `pending` / `plugin`, with a 30 s grace period, one tolerated soft error, an 11-minute stall watchdog, and a re-check on every watch ping so it picks the plugin up when it's installed or the preview is turned on (`src/pkjs/glucose_plugin.js`).
- **Check, during detection, that your uuid is listed with the category/item you need,** not just that the API functions exist. Whether they exist with the preview off wasn't checked, and their existence alone says nothing about your plugin being usable.

### 6.1 When the host reads a source

From mobileapp `dbc937e` (`libpebble3/src/commonMain/kotlin/io/rebble/libpebblecommon/`):

- **Every subscription has its own poll loop.** `JsPlugin.observe()` (`plugin/JsPlugin.kt:124-135`) requests, sends the answer, then waits `withTimeoutOrNull(suggestedRefreshIntervalSec) { refreshRequests.first { it == key } }`, and repeats. Each `subscribeToSource` starts a new loop through `SourceDispatcher.subscribe` → `PluginClient.observe` → `JsPlugin.observe` (`plugin/SourceDispatcher.kt:61-91`, `plugin/PluginClient.kt:103-142`, `:198-206`). Nothing is shared or replayed between subscriptions.
- **A new subscription reads at once.** The loop requests before its first wait. On the phone a subscribe or a resubscribe delivered within about 1 s. `unsubscribe()` cancels the old loop (`SourceDispatcher.kt:94-96`). On Android, callbacks still in flight for the old subscription are dropped (`androidMain/assets/startup.js:310-311`); iOS wasn't checked.
- **What ends the wait early** (`refreshRequests`, fed in two places only):
  - `Pebble.refreshSources([...])` called by the **plugin** (`plugin/JsPlugin.kt:429-432`, `plugin/PluginHostJs.kt:55`). PKJS has no `refreshSources` (`startup.js:540-549` exposes `subscribeToSource`, `enumeratePlugins`, `invokeAction`).
  - The `refreshed` list of a successful **action** (`JsPlugin.kt:183`), which a consumer can call with `Pebble.invokeAction`. But an app invoking an action of a plugin that can send data off the phone needs the user's `InvokeAction` permission as well (guide; `PluginClient.kt:171-172`), and `Internet` counts (`permissions/PermissionRegistry.kt:32`, kind `Exfiltrating`). The action is also offered to Index.
  - A refresh emitted while the loop isn't waiting (for example during a request) is lost: `refreshRequests` is a `MutableSharedFlow` without replay (`JsPlugin.kt:87-90`).
- **`validUntilMs` doesn't affect scheduling.** It is passed through into the envelope (`JsPlugin.kt:198-203`) and ignored for change detection (`plugin/PluginUpstreams.kt:101`). `maxStalenessMs` on subscribe is parsed but never used (`SourceDispatcher.kt:113`, not passed on at `:72-78`).
- **The poll interval counts awake time only.** The loop's scope has no dispatcher (`di/LibPebbleModule.kt:354`: `CoroutineName` only), so its timeout runs on kotlinx-coroutines' default delay: `DefaultExecutor` (`System.nanoTime` / `parkNanos`) or the main dispatcher (`DefaultExecutor.kt` `initializeDefaultDelay`, kotlinx master; the app's exact version wasn't checked). Android's `SystemClock` documentation: `uptimeMillis` "stops when the system enters deep sleep" and is "the basis for … `Object.wait`, and `System.nanoTime()`"; `Handler` uses it too. libpebble3 takes no wakelock and uses no `AlarmManager` (searched; the app module outside libpebble3 wasn't). So a "60 s" wait lasts 60 s of awake time.
  - That this caused the gaps we saw is a **hypothesis**, consistent with the log: 60 s polls only right after subscribing, gaps of about 6 minutes later, and a gap ending at the second a watch message woke the phone. Not proven.
- **What to do as a consumer:** the watch talking to the phone wakes it. If your watchapp knows data is due, have it message PKJS, and resubscribe from there to get an immediate read (Rat Scout: `refreshIfOverdue` in `src/pkjs/glucose_plugin.js`, §9 last row). Rate-limit it, and keep the plugin's own cache and throttle, because every resubscribe runs the plugin.

## 7. Building the pbws

- **SDK 4.33.1 can't build a plugin pbw.** `pebble build` copies the `plugin` and `usesPermissions` blocks into `appinfo.json`, but it doesn't set `manifestVersion`, doesn't add the script to the pbw, and doesn't validate `definesPermissions`.
- **The fix exists but isn't released.** PebbleOS PR #2483 (merged 2026-10-19) adds all three, plus `"projectType": "plugin"` for plugin-only pbws. No SDK on the server contains it yet.
- **Until then, post-process the pbw:**
  - **Upstream:** `scripts/pack-plugin-pbw.py` in `coredevices/pebble-apps`. Note that it opens `build/<package.json name>.pbw`, while `pebble build` names the pbw after the *directory*.
  - **Rat Scout:** `python3 -I scripts/pack-plugin.py` builds the watchface and sets `manifestVersion: 2` (`build/rat-scout.pbw`; a consumer needs it too), and builds the plugin-only pbw from `plugin/` with no SDK involved: `appinfo.json` from `plugin/package.json`, plus `plugin.js` and `config.html` (`build/rat-scout-glucose.pbw`). It validates `definesPermissions` as PR #2483 does.
- **Bump the version when you change the manifest.** The phone re-registers a plugin only when its locker version changes (`LockerPluginLoader.kt:60`), so a reinstall at the same version keeps the old manifest, `script` path included. The script itself is read from the cached pbw on every run.

## 8. Testing

Rat Scout's plugin builds into `plugin/plugin.js` with `node scripts/build-plugin.js`; a test fails if the committed file is stale.

### Unit tests (fast, run on every change)
- Load the bundle in a Node `vm` context with mock `fetch`, `localStorage` and `Pebble`, **after applying the lockdown getters** (§5.1). See `test/helpers/plugin_host.js` and `test/plugin.test.js`.
- Assert that every emitted shape is declared, and that the committed bundle matches a fresh build.

### Emulator (pebble-tool 5.1.2 / pypkjs 3.0.3)
- **What works:**
  - `pebble install --emulator flint --logs <plugin pbw>` loads the plugin, and `pebble plugins` lists it.
  - `plugin>` logs show up.
  - `localStorage` is shared with the same pbw's PKJS.
  - A plugin-only pbw and a consumer pbw can be installed one after the other and work together.
  - Plugin settings pages and `Pebble.secureStorage` exist (pypkjs `runner/config_pages.py`, `plugins/js_plugin.py`).
- **Seeding state for a test run:** a pbw's `localStorage` is a `dbm.dumb` store at `<persist dir>/localstorage/<uuid>`, and a plugin's `secureStorage` is plain JSON at `<persist dir>/plugin-secure-storage/<uuid>.json` (pypkjs `SecureStorage`). `scripts/plugin-smoke.sh` seeds both after `pebble wipe`.
- **The first install after `pebble wipe` can race the emulator's boot** ("Connection refused"); retry it once.
- **How it differs from the phone:**
  - **No lockdown:** XHR and timers exist, so a plugin that touches them still works here.
  - A plugin's `respond.error` is logged and skipped instead of reaching the caller's `onError`.
  - Every caller permission is granted; `pebble emu-permission` only knows `WatchMicrophone`.
  - The plugin API is exposed whatever the caller's `manifestVersion` is.
- **Lines logged right at `ready` can be missing** from `pebble install --logs`, on the emulator and on the phone: the log stream attaches after the app has started. Don't make a check depend on them.
- **Use it for:** the data path and logging. Use the phone for the sandbox, errors and permissions.
- **Network safety:** pypkjs uses `requests`, so `HTTPS_PROXY=http://127.0.0.1:9` blocks every request. `scripts/plugin-smoke.sh` relies on that to run with fake credentials.

### Real phone
1. **Turn on the app's developer connection** in the Pebble app's settings.
2. **If your machine can't reach the phone's IP** (a container, another network), go through CloudPebble: `pebble login`, then `pebble install <pbw> --logs --phone`. With `--phone` and no IP, the CloudPebble proxy is used.
   - Headless login: `pebble login --no-open-browser` prints a URL. After signing in, the browser fails to load `http://localhost:60000/?…`; deliver that address inside the container (`curl '<address>'`). Rat Scout wraps this as `scripts/device-check.sh login` / `callback`.
3. **Put the pbw path before `--phone`.** `--phone` takes an optional value, so a pbw after it is read as the phone address.
4. **pebble-tool 5.1.1/5.1.2 log-printer race:** it registers its log handlers before loading `build/pebble-js-app.js.map`. A PKJS log line arriving in between crashes it with `'PebbleLogPrinter' object has no attribute 'sourcemap'`. Running `pebble` from an empty directory (no sourcemap to load) avoids it.
5. **On the phone itself:**
   - **Apps → Plugins** lists your plugin. Its page shows permissions with "used … ago" and the sources it serves.
   - **"PLUGIN CODE → View Source"** shows the script the app actually loads. "Couldn't load `<path>`" means the cached pbw doesn't contain the manifest's `script` path.
6. **`scripts/device-check.sh`** wraps all of this: install, capture redacted logs, screenshots, and a log summary that fails on crashes, resends or an unexpected mode. Run `scripts/device-check.sh steps` for the checklist.
7. **Never log secrets:** logs from a real phone end up in terminals and transcripts. Rat Scout logs "Session ID received", not the ID.

## 9. Pitfalls we hit (in order)

| Symptom | Cause | Fix |
|---|---|---|
| Emulator fine, phone `PLUGIN_UNAVAILABLE` "no source handler registered", no `plugin>` logs | Bundle probed `setTimeout` at load; the lockdown getter threw; the error was swallowed | Probe host globals in `try/catch` only; simulate the lockdown in tests (§5.1) |
| "Couldn't load src/plugin/index.js" in View Source | Reinstalled a pbw with a different `script` path at the **same version**, so the stale manifest pointed at a file that wasn't in the new pbw | Bump the version on manifest changes (§7) |
| A full login every poll while the upstream had no data | Session cleared on every failure | Keep the session unless the login itself failed (§5.2) |
| The face didn't pick the plugin up after the preview was turned on | Detection ran only on `ready` | Re-check while the plugin is unavailable (§6) |
| `pebble logs` crashed on the first PKJS line | pebble-tool sourcemap race | Run from an empty directory (§8) |
| `pebble build` "SRE module mismatch" | pebble-tool and the SDK venv on different Python versions | Install pebble-tool on the SDK's Python (3.13) |
| The plugin's page listed the face's weather domains and location | Permissions are per pbw: one pbw shows the union | Ship the plugin as its own plugin-only pbw (§3) |
| After the split the plugin had no credentials | Different uuid, so no shared `localStorage` with the face's Clay settings | A plugin settings page; password in `secureStorage` (§5.3) |
| The old Dexcom password stayed in the face's storage | Clay keeps every key it ever stored, even after the field is removed | Purge obsolete keys on `ready` (`src/pkjs/legacy_cleanup.js`) |
| The face kept a stale reading for 11 min after the preview was turned off | The phone closed the subscription with `UNKNOWN` "… subscribe again", which the face counted as a soft error | Treat that message as "subscription closed": detect again at once (§6) |
| A start-up log line never appeared | `pebble install --logs` attaches after `ready` | Don't rely on lines logged at `ready` (§8) |
| Readings reached the watch 1–5 min late, one skipped, although the plugin asked for 60 s polls | The host's poll timeout counts only awake time (§6.1); a sleeping phone polled about every 6 min | The watch pings PKJS every minute while a reading is late (up to 10 min after it); PKJS resubscribes (at most once per 55 s), and the host reads at once. Keep the plugin's cache and throttle so this can't raise upstream load |

## 10. References

- Official guide: https://developer.repebble.com/guides/plugins/preview/ (2026-10-30) and https://developer.repebble.com/guides/plugins/publishing-plugins/
- Examples: https://github.com/coredevices/pebble-apps (`stocks` is the simplest plugin; `weather-face` consumes one from ES5 PKJS; `plugin-test` bundles a plugin with a watchapp)
- SDK support: https://github.com/coredevices/PebbleOS/pull/2483
- Phone host source: https://github.com/coredevices/mobileapp (`libpebble3/.../plugin/`, `.../js/JsEngine.android.kt`, `.../locker/Locker.kt`)
- In this repo: design and verification status in [.github/ARCHITECTURE.md](../.github/ARCHITECTURE.md) ("Plugin (preview)", "Verification status"); commands in [README.md](../README.md)
