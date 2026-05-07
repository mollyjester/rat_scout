Before doing any work in this repository, read these two files in full:

- .github/ARCHITECTURE.md — repository structure, data flow, message types, persist keys, overlay implementation
- .github/GUIDELINES.md — C and JS conventions, doc style, naming, SDK gotchas, testing rules, resource rules

Key rules that must never be violated:
- Always run `pebble build` after C changes and confirm it succeeds on all platforms
- Always run `node test/*.test.js` after JS changes and confirm all suites pass with no warnings
- Update README.md whenever there is a functional change to the watchface
- Never use `Pebble.sendAppMessage` directly — always use `sendToPebble()` queue
- Target platforms are aplite, basalt, diorite, emery — never add chalk
- Overlay layer must always be added last in window load (top z-order)
- Use GCompOpSet before drawing PNG bitmaps that require transparency
