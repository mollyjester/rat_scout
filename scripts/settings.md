# Watchface Settings Reference

These are all the keys the Clay settings page (`src/pkjs/config.json`) saves to the phone's localStorage under `clay-settings`. PebbleKit JS reads them from there at startup. `scripts/settings.json` lists every key, and `run-emulator.sh --settings <file>` seeds them into the emulator.

## Defaults vs. missing keys

The **Default** columns below are Clay's `defaultValue`, which applies only when settings are saved from the settings page: the page pre-fills every field, so every key gets saved. A file passed with `--settings` is written to localStorage as-is. Keys set to `null`, or left out, are not in `clay-settings` at all, and PebbleKit JS (`src/pkjs/index.js`, `glucose.js`, `garbage.js`) applies its own fallback instead. For most keys the fallback matches the default. For these keys it does not, so set them explicitly:

| Key | Clay default | If missing |
|-----|--------------|------------|
| `BG_SHOW_DELTA` | `true` | off |
| `BG_SHOW_TIMEDELTA` | `true` | off |
| `GARBAGE_ORGANIC_DAYS` | Mon, Wed, Fri | no days |
| `GARBAGE_GREY_DAYS` | Thu | no days |
| `GARBAGE_BLACK_DAYS` | Tue, Sat | no days |

## All keys at a glance

| Key | Clay default | If missing |
|-----|--------------|------------|
| `DEX_LOGIN` | `""` | no glucose fetch |
| `DEX_PASSWORD` | `""` | no glucose fetch |
| `DEX_REGION` | `"ous"` | `"ous"` |
| `BG_UNITS` | `"mg/dL"` | `"mg/dL"` |
| `BG_SHOW_DELTA` | `true` | **off** |
| `BG_SHOW_TIMEDELTA` | `true` | **off** |
| `BG_VIBRATION` | `false` | off |
| `BG_LOW_SOUND` | `false` | off |
| `BG_HIGH_SOUND` | `false` | off |
| `BG_LOW_THRESHOLD` | `""` | sent as `0`, same as `""` |
| `BG_HIGH_THRESHOLD` | `""` | sent as `0`, same as `""` |
| `BG_NIGHT_LOW_THRESHOLD` | `""` | general threshold used |
| `BG_NIGHT_HIGH_THRESHOLD` | `""` | general threshold used |
| `BG_NIGHT_START` | `""` | no night window |
| `BG_NIGHT_END` | `""` | no night window |
| `DATE_FORMAT` | `"dd.mm"` | `"dd.mm"` |
| `HOURLY_VIBRATION` | `false` | off |
| `HOURLY_SOUND` | `false` | off |
| `OWM_API_KEY` | `""` | weather skipped |
| `WEATHER_UNITS` | `"metric"` | `"metric"` |
| `WEATHER_INTERVAL` | `"60"` | 60 minutes |
| `ASTRO_API_KEY` | `""` | astronomy shows N/A |
| `GARBAGE_PICKUP_TIME` | `"9"` | 9 |
| `GARBAGE_ORGANIC_DAYS` | `[true,false,true,false,true,false,false]` | **no days** |
| `GARBAGE_GREY_DAYS` | `[false,false,false,true,false,false,false]` | **no days** |
| `GARBAGE_BLACK_DAYS` | `[false,true,false,false,false,true,false]` | **no days** |
| `ALERT_OVERLAY_ENABLE` | `false` | off |
| `ALERT_OVERLAY_DURATION` | `"10"` | 10 seconds |

---

## Read by the plugin

The plugin (`src/plugin/index.js`, preview) shares this localStorage and reads `clay-settings` too: `DEX_LOGIN`, `DEX_PASSWORD` and `DEX_REGION` for the Dexcom account, and `BG_UNITS` to format `glucose`/`delta` (its `glucose_mgdl`/`delta_mgdl` are always mg/dL). It has no settings of its own. Besides `clay-settings`, the plugin and PKJS keep these non-settings keys in the same store (see `.github/ARCHITECTURE.md`, "Shared localStorage keys"): `accountId`, `sessionId`, `ratscout.plugin.lastReading`, `ratscout.plugin.lastAttempt`, `ratscout.auth.inflight`, `ratscout.auth.badcreds`, `ratscout.auth.sessionCredKey`. `--settings` only writes `clay-settings`; `pebble wipe` clears all of them.

## Dexcom Account

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `DEX_LOGIN` | string | `""` | Dexcom account username / phone number |
| `DEX_PASSWORD` | string | `""` | Dexcom account password |
| `DEX_REGION` | string | `"ous"` | Dexcom server region |

**`DEX_REGION` values:**

| Value | Meaning |
|-------|---------|
| `"ous"` | Outside US (default) |
| `"us"` | United States |
| `"jp"` | Japan |

---

## Blood Glucose

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `BG_UNITS` | string | `"mg/dL"` | Display units for BG readings |
| `BG_SHOW_DELTA` | boolean | `true` | Show BG delta (change since last reading) |
| `BG_SHOW_TIMEDELTA` | boolean | `true` | Show time since last reading |
| `BG_VIBRATION` | boolean | `false` | Vibrate when BG crosses a threshold |
| `BG_LOW_SOUND` | boolean | `false` | Play sound on low BG alert |
| `BG_HIGH_SOUND` | boolean | `false` | Play sound on high BG alert |
| `BG_LOW_THRESHOLD` | string | `""` | Low BG threshold in the chosen units, e.g. `"3.9"` or `"70"` |
| `BG_HIGH_THRESHOLD` | string | `""` | High BG threshold in the chosen units, e.g. `"10"` or `"180"` |

**`BG_UNITS` values:**

| Value | Meaning |
|-------|---------|
| `"mg/dL"` | Milligrams per decilitre (default) |
| `"mmol/L"` | Millimoles per litre |

### Night Thresholds

Optional. When set, these override the general thresholds during the configured night window. If left empty/null, the general thresholds above are used at all times.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `BG_NIGHT_LOW_THRESHOLD` | string | `""` | Night low BG threshold in the chosen units |
| `BG_NIGHT_HIGH_THRESHOLD` | string | `""` | Night high BG threshold in the chosen units |
| `BG_NIGHT_START` | string | `""` | Hour when night window begins (`"0"`–`"23"`) |
| `BG_NIGHT_END` | string | `""` | Hour when night window ends (`"0"`–`"23"`) |

---

## Watchface

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `DATE_FORMAT` | string | `"dd.mm"` | Date display format |
| `HOURLY_VIBRATION` | boolean | `false` | Vibrate once at the top of each hour |
| `HOURLY_SOUND` | boolean | `false` | Play a sound at the top of each hour |

**`DATE_FORMAT` values:**

| Value | Example |
|-------|---------|
| `"dd.mm"` | 11.05 (default) |
| `"mm.dd"` | 05.11 |

---

## Weather

Requires a free [OpenWeatherMap](https://openweathermap.org/api) API key.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `OWM_API_KEY` | string | `""` | OpenWeatherMap API key |
| `WEATHER_UNITS` | string | `"metric"` | Temperature and wind speed units |
| `WEATHER_INTERVAL` | string | `"60"` | How often to fetch weather (minutes) |

**`WEATHER_UNITS` values:**

| Value | Units |
|-------|-------|
| `"metric"` | °C, m/s (default) |
| `"imperial"` | °F, mph |

**`WEATHER_INTERVAL` values:**

| Value | Meaning |
|-------|---------|
| `"30"` | Every 30 minutes |
| `"60"` | Every hour (default) |
| `"120"` | Every 2 hours |
| `"180"` | Every 3 hours |

---

## Astronomy

Requires a free [ipgeolocation.io](https://ipgeolocation.io/) API key for sunrise/sunset and moonrise/moonset times.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `ASTRO_API_KEY` | string | `""` | ipgeolocation.io API key |

---

## Garbage Collection

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `GARBAGE_PICKUP_TIME` | string | `"9"` | Hour of day when collection is considered done (`"0"`–`"23"`) |
| `GARBAGE_ORGANIC_DAYS` | boolean[7] | `[true,false,true,false,true,false,false]` | Days organic (green) bag is collected |
| `GARBAGE_GREY_DAYS` | boolean[7] | `[false,false,false,true,false,false,false]` | Days grey bag is collected |
| `GARBAGE_BLACK_DAYS` | boolean[7] | `[false,true,false,false,false,true,false]` | Days black bag is collected |

The day arrays have **7 elements** in **Mon–Sun** order:

```
index:  0     1     2     3     4     5     6
day:   Mon   Tue   Wed   Thu   Fri   Sat   Sun
```

Example — collection every Monday and Thursday:
```json
"GARBAGE_GREY_DAYS": [true, false, false, true, false, false, false]
```

---

## Quick View Alerts

Shows a brief overlay banner on the watchface when a vibration alert fires.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `ALERT_OVERLAY_ENABLE` | boolean | `false` | Enable the overlay alert banner |
| `ALERT_OVERLAY_DURATION` | string | `"10"` | How long the banner stays visible (seconds) |

**`ALERT_OVERLAY_DURATION` values:**

| Value | Meaning |
|-------|---------|
| `"3"` | Short (3 s) |
| `"10"` | Normal (10 s, default) |
| `"20"` | Long (20 s) |
