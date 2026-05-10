# AGENTS.md — Mandatory reading for all AI agents

Before doing any work in this repository, read these two files in full:

- `.github/ARCHITECTURE.md` — repository structure, data flow, message types, persist keys, overlay implementation
- `.github/GUIDELINES.md` — C and JS conventions, doc style, naming, SDK gotchas, testing rules, resource rules

## Mandatory checks after every change

| Change type      | Required verification                                      |
|------------------|------------------------------------------------------------|
| Any C file       | `pebble build` must succeed (all 5 platforms, 0 errors)    |
| Any JS file      | `node test/*.test.js` — all suites pass, no warnings       |
| Functional change| Update README.md to reflect the change                     |

## Hard rules
- **Never make assumptions stated as facts.** Before claiming any technical behavior (hardware sharing, SDK semantics, peripheral interaction, platform identity, etc.), verify it against primary sources (PebbleOS source under `/tmp/PebbleOS` or upstream, SDK headers, board configs). If you cannot verify, say so explicitly. This rule was added after a costly debug session in which the agent fabricated a "speaker shares hardware with vibration motor on flint/emery" claim that was disproven by reading `src/fw/board/boards/board_asterix.c` (DA7212/I2S) and `board_asterix.h` (DRV2604/GPIO) — they are entirely separate peripherals.
- **Never assume the user's device platform.** Ask before debugging platform-specific issues. The 5 target platforms have very different hardware.
- Never use `Pebble.sendAppMessage` directly — always route through `sendToPebble()` queue
- Target platforms: aplite, basalt, diorite, emery, flint
- Overlay layer must be added last in `main_window_load` to stay on top
- PNG bitmaps with transparency require `graphics_context_set_compositing_mode(ctx, GCompOpSet)` before drawing; reset to `GCompOpAssign` after
- Always call `speaker_stop()` before `speaker_play_tone` / `speaker_play_tracks`; sound is only audible on Emery and Flint (no-op on aplite/basalt/diorite)
- New persist keys must not collide — check rat_scout.h, current max is 117
- Clay `defaultValue` in config.json is authoritative for initial UI — not the C-side default
