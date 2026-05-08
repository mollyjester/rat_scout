# Rat Scout — Code Guidelines

## General
- Language: C (Pebble SDK 4.9) + JavaScript (PebbleKit JS, ES5)
- Build: `pebble build` (waf). Clean build: `pebble clean && pebble build`. Always verify build is clean after changes.
- Tests: `node test/*.test.js` — all suites must pass, no warnings. Run after any JS change.
- **README.md must be updated whenever there is a functional change to the watchface** (new features, removed features, changed settings, changed platforms, changed architecture).

## C Conventions

### File structure order
1. `#include "rat_scout.h"`
2. `// ===== Section name =====` dividers
3. Constants (`#define`)
4. Shared globals (extern'd in rat_scout.h)
5. Private state (`static`)
6. Private helpers (`static`, documented with Doxygen-style comments)
7. Public API (documented with Doxygen-style comments)

### Documentation style (must match existing files)
Every non-trivial function gets a block comment:
```c
/**
 * One-line summary of what the function does.
 * Additional detail if needed. Note deviations from expected SDK behaviour
 * using the DEVIATION: prefix.
 * @param paramName - Description of parameter
 * @returns Description (for non-void functions)
 */
```
- Private static helpers also get doc comments
- Inline comments use `//` with a space
- Section dividers: `// ===== Section Name =====`
- DEVIATION notes: `// DEVIATION: explanation — SDK behaviour reference`

### Naming
- Globals shared across files: `s_` prefix (e.g. `s_overlay_enabled`)
- Private file-static: `s_` prefix
- Constants/macros: `UPPER_SNAKE_CASE`
- Functions: `snake_case`, public API named `module_verb[_noun]()`
- Persist keys: `PERSIST_KEY_*` constants defined in rat_scout.h
- Message keys: `MESSAGE_KEY_*` (auto-generated from package.json messageKeys)
- Resource IDs: `RESOURCE_ID_*` (auto-generated)

### Pebble SDK gotchas
- `mktime()` in PebbleOS normalises via `gmtime_r` — use `time(NULL)` instead
- `vibes_cancel()` must precede app vibe patterns to avoid silent drops
- `speaker_stop()` must precede `speaker_play_tone` / `speaker_play_tracks` to preempt any in-progress sound
- `SpeakerNote` is a packed struct: `{midi_note, waveform, duration_ms, velocity, reserved}` — reserved must be 0
- `speaker_*` calls are silent no-ops on platforms without a speaker (aplite/basalt/diorite); behaviour is correct on Emery
- `GCompOpSet` required for PNG transparency; reset to `GCompOpAssign` after
- `gdraw_command_image_*` is for PDC files; use `gbitmap_*` + `graphics_draw_bitmap_in_rect` for PNG
- Overlay layer must be added last (top z-order)
- Clay `defaultValue` in config.json is the source of truth for initial UI — C-side defaults only apply after first settings send

### Memory management
- Always `gbitmap_destroy` / `layer_destroy` in the matching unload/deinit
- `destroy_icon_layer(layer, bitmap)` helper in ui_helpers.c for bitmap layers

## JavaScript Conventions

### File structure
- All JS is ES5 (no arrow functions, no template literals, no const/let)
- Module exports: `module.exports = function(...) { ... }`
- Logging: `console.log(...)` / `console.error(...)` — keep messages descriptive

### Message queue
- All Pebble messages go through `sendToPebble(dictionary, messageType)`
- Direct `Pebble.sendAppMessage` is forbidden — use the queue to prevent concurrent sends
- On `webviewclosed`: always call `sendSettings()` before any test command so settings arrive first

### Settings
- `appSettings = getSettings()` fetches from `clay-settings` localStorage
- `sendSettings()` builds and queues MSG_TYPE_SETTINGS
- parseInt fallback pattern: `parseInt(appSettings.FOO, 10) || defaultValue`

### Clay custom function (clay-config.js)
- Use `attachFlagButton(id, flagKey, flagValue)` for all test buttons
- `attachVibeButton(id, patternId)` and `attachSoundButton(id, patternId)` are wrappers around `attachFlagButton`
- Every button registered in config.json must be registered in clay-config.test.js mocks

## Testing Conventions
- Test files: `test/*.test.js`, plain Node.js, no frameworks
- Pattern: IIFE per test case, `assert(condition, message)`, results printed at end
- `process.exit(failed > 0 ? 1 : 0)`
- Mock all external dependencies (localStorage, Pebble, location, Clay)
- Every Clay button added to clay-config.js must have:
  1. `config.registerItem(id)` in all existing test setups
  2. A dedicated test case verifying click → correct payload flag

## Resource Guidelines
- PNG icons: transparent background, use `GCompOpSet` when drawing
- Resource type in package.json: `"png"` for bitmaps, `"raw"` for pre-built binary blobs, `"font"` for TTF
- New resources must be added to `package.json` `resources.media` array
- Icon sizes: status bar 12×12, overlay alert 24×24

## Persist Key Assignment
- Check rat_scout.h before adding new keys to avoid collisions
- Document new keys in rat_scout.h with inline comment stating their purpose
- Current max used: 117 (PERSIST_KEY_HOURLY_SOUND)
