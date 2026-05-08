# AGENTS.md — Mandatory reading for all AI agents

Before doing any work in this repository, read these two files in full:

- `.github/ARCHITECTURE.md` — repository structure, data flow, message types, persist keys, overlay implementation
- `.github/GUIDELINES.md` — C and JS conventions, doc style, naming, SDK gotchas, testing rules, resource rules

## Mandatory checks after every change

| Change type      | Required verification                                      |
|------------------|------------------------------------------------------------|
| Any C file       | `pebble build` must succeed (all 4 platforms, 0 errors)    |
| Any JS file      | `node test/*.test.js` — all suites pass, no warnings       |
| Functional change| Update README.md to reflect the change                     |

## Hard rules
- Never use `Pebble.sendAppMessage` directly — always route through `sendToPebble()` queue
- Target platforms: aplite, basalt, diorite, emery — **never chalk**
- Overlay layer must be added last in `main_window_load` to stay on top
- PNG bitmaps with transparency require `graphics_context_set_compositing_mode(ctx, GCompOpSet)` before drawing; reset to `GCompOpAssign` after
- Always call `speaker_stop()` before `speaker_play_tone` / `speaker_play_tracks`; sound is only audible on Emery (no-op on aplite/basalt/diorite)
- New persist keys must not collide — check rat_scout.h, current max is 117
- Clay `defaultValue` in config.json is authoritative for initial UI — not the C-side default
