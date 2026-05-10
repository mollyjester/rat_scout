# CLAUDE.md — Mandatory reading for Claude

Before doing any work in this repository, read these two files in full:

- `.github/ARCHITECTURE.md` — repository structure, data flow, message types, persist keys, overlay implementation
- `.github/GUIDELINES.md` — C and JS conventions, doc style, naming, SDK gotchas, testing rules, resource rules

## Mandatory checks after every change

| Change type       | Required verification                                      |
|-------------------|------------------------------------------------------------|
| Any C file        | `pebble build` must succeed (all 5 platforms, 0 errors)    |
| Any JS file       | `node test/*.test.js` — all suites pass, no warnings       |
| Functional change | Update README.md to reflect the change                     |

## Hard rules
- **Never make assumptions stated as facts.** Before claiming any technical behavior (hardware sharing, SDK semantics, peripheral interaction, platform identity, etc.), verify it against primary sources (PebbleOS source under `/tmp/PebbleOS` or upstream, SDK headers, board configs). If you cannot verify, say so explicitly. This rule was added after a costly debug session in which the agent fabricated a "speaker shares hardware with vibration motor on flint/emery" claim that was disproven by reading `src/fw/board/boards/board_asterix.c` (DA7212/I2S) and `board_asterix.h` (DRV2604/GPIO) — they are entirely separate peripherals.
- **Never assume the user's device platform.** Ask before debugging platform-specific issues. The 5 target platforms have very different hardware.
- Never use `Pebble.sendAppMessage` directly — always route through `sendToPebble()` queue
- Target platforms: aplite, basalt, diorite, emery, flint
- Overlay layer must be added last in `main_window_load` to stay on top
- PNG bitmaps with transparency require `graphics_context_set_compositing_mode(ctx, GCompOpSet)` before drawing; reset to `GCompOpAssign` after
- Always call `speaker_stop()` before `speaker_play_tone` / `speaker_play_tracks`; sound is only audible on Emery and Flint (no-op on aplite/basalt/diorite)
- **Clay test buttons must behave like Save Settings + trigger their alarm.** Vibe/Sound/Overlay test buttons in `clay-config.js` use `attachFlagButton()` which calls `clayConfig.serialize()` (capturing current form state), appends a `_vibeTest`/`_soundTest`/`_overlayTest` flag, and POSTs to `pebblejs://close#`. The webviewclosed handler in `index.js` then runs `clay.getSettings(e.response)` (persists to localStorage), `sendSettings()` (push to watch), and finally sends the test command. Never bypass this save-equivalent flow when adding new test buttons.
- **Speaker tracks need a 350 ms silent prefix and suffix.** All alert tracks in `sounds.c` start and end with `SILENCE_BUF` (midi=0, 350 ms triangle rest) so the DA7212 cold-start ramp on flint/emery cannot eat the first audible note.
- **Speaker volume is set once at app init.** `sounds_init()` calls `speaker_set_volume(100)` exactly once. Per-playback volume goes through the `volume` argument of `speaker_play_tracks()`. Do not add `speaker_set_volume()` calls in `play_tracks()` or hot paths — they cost I2C and are no-op on cold start (`audio_set_volume` early-returns while `is_running == false`).
- New persist keys must not collide — check rat_scout.h, current max is 117
- Clay `defaultValue` in config.json is authoritative for initial UI — not the C-side default
