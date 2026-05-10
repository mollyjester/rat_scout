Before doing any work in this repository, read these two files in full:

- .github/ARCHITECTURE.md — repository structure, data flow, message types, persist keys, overlay implementation
- .github/GUIDELINES.md — C and JS conventions, doc style, naming, SDK gotchas, testing rules, resource rules

Key rules that must never be violated:
- **Never make assumptions stated as facts.** Before claiming any technical behavior (hardware sharing, SDK semantics, peripheral interaction, platform identity, etc.), verify it against primary sources (PebbleOS source under `/tmp/PebbleOS` or upstream, SDK headers, board configs). If you cannot verify, say so explicitly.
- **Never assume the user's device platform.** Ask before debugging platform-specific issues.
- Always run `pebble build` after C changes and confirm it succeeds on all platforms
- Always run `node test/*.test.js` after JS changes and confirm all suites pass with no warnings
- Update README.md whenever there is a functional change to the watchface
- Never use `Pebble.sendAppMessage` directly — always use `sendToPebble()` queue
- Target platforms are aplite, basalt, diorite, emery, flint
- Overlay layer must always be added last in window load (top z-order)
- Use GCompOpSet before drawing PNG bitmaps that require transparency
- Always call `speaker_stop()` before `speaker_play_tone` / `speaker_play_tracks` to preempt in-progress sound
- Sound output is only audible on Emery and Flint; the SDK speaker_* calls are silent no-ops on aplite/basalt/diorite
