# Running the Emulator (noVNC)

How to run Rat Scout in the Pebble emulator headlessly, view it in a browser over noVNC, pre-seed Clay settings, and take screenshots.

Everything here assumes the dev container (see `.devcontainer/`), or an Ubuntu 24.04 machine with the same packages, `pebble-tool` and the Pebble SDK installed. Run all commands from the repository root.

## Start

```bash
pebble build                 # or pass --build to the script for a clean build
./scripts/run-emulator.sh    # flint by default
```

Useful options (see `./scripts/run-emulator.sh --help`):

| Option | Effect |
|--------|--------|
| `--platform flint\|emery` | Emulator platform (default `flint`) |
| `--build` | `pebble clean && pebble build` before installing |
| `--settings <file>` | Pre-seed Clay settings (see below) |
| `--loc <city>` | Fixed phone location and matching timezone, e.g. `--loc Malta` |

The script:

1. Starts Xvfb if there is no display, wipes the emulator state, seeds settings/location, and installs the app (`pebble install --emulator <platform> --vnc`).
2. Serves noVNC on port **6080**. Open it in a browser:

   ```
   http://localhost:6080/vnc_lite.html?autoconnect=true&resize=scale
   ```

   Port 6080 is listed in `forwardPorts` in `.devcontainer/devcontainer.json`; in a Codespace the script prints the forwarded URL instead.
3. Opens the Clay settings page and prints its URL (`Settings page: http://localhost:<port>/config`). The script waits here until the page is submitted or closed.
4. Streams logs from both sides: lines prefixed `pkjs>` are PebbleKit JS `console.log`, lines prefixed `<file>.c:<line>>` are C `APP_LOG`.

## Stop

In the terminal running the script, press **Ctrl+C**. The script's cleanup stops QEMU, pypkjs, websockify and Xvfb, and restores the SDK's original `browser.py` (the script temporarily replaces it with `scripts/browser_override.py`).

If the script runs in the background, use SIGTERM, not SIGINT: a job started with `&` or `nohup` from a non-interactive shell ignores SIGINT. Signal the script first, then the command it is waiting on (`pebble emu-app-config` or `pebble logs`). Bash runs the script's cleanup trap once that command exits:

```bash
S=<pid of "bash ./scripts/run-emulator.sh">
kill -TERM "$S"
kill -TERM $(ps -o pid=,args= --ppid "$S" | awk '/pebble/ {print $1}')
```

Avoid `pkill -f '<pattern>'` from a shell whose own command line contains the pattern: it kills that shell too. The script's own cleanup runs `pkill -f` for `qemu.*pebble`, `pypkjs` and `websockify.*6080`, so a shell that signals the script should not mention those strings in the same command (e.g. in a follow-up `grep`), or it is killed as well.

`pebble kill` alone stops the emulator but skips the script's cleanup, so the swapped `browser.py` would stay in place until the next script run restores it. If the emulator gets stuck, `pebble kill && pebble wipe` resets it.

## Seed Clay settings

Pass a JSON file with `--settings`. The script writes its non-null values into the emulated phone's localStorage under `clay-settings` before each install attempt (the wipe clears it). PebbleKit JS reads it at startup and sends the settings to the watch, exactly as if they had been saved on the settings page.

```bash
./scripts/run-emulator.sh --settings scripts/settings.json
```

- `scripts/settings.json` is a template listing every key; `null` keys are left out so Clay uses its `defaultValue`. `scripts/settings.md` documents each key.
- Keep files with credentials or API keys out of git, e.g. under `scripts/params/` (gitignored):

  ```json
  {
    "OWM_API_KEY": "<openweathermap key>",
    "ASTRO_API_KEY": "<ipgeolocation key>",
    "DATE_FORMAT": "mm.dd"
  }
  ```

- The watchface's first frame after a wipe uses the C-side defaults; the seeded settings arrive about a second later when the JS starts.

### Location

`--loc <city>` geocodes the name with Open-Meteo, sets `TZ` so the emulator shows that city's local time, and writes the coordinates to `<persist dir>/location.json`, which pypkjs uses for `navigator.geolocation` instead of an IP lookup. Without `--loc` the wipe removes the file and the IP lookup applies.

## Screenshots

While the emulator runs, from another terminal:

```bash
mkdir -p out    # pebble screenshot does not create directories
pebble screenshot --no-open --emulator flint --vnc out/flint.png
```

Use the same `--emulator` platform the script started. `--vnc` is needed on every `--emulator` command when there is no display.

## Other commands

```bash
pebble logs --emulator flint --vnc                     # stream C + JS logs
pebble install --emulator flint --vnc                  # reinstall after a rebuild (restarts the app)
pebble emu-button click select --emulator flint --vnc  # press back/up/select/down
pebble emu-app-config --emulator flint --vnc           # reopen the settings page
```

When the script was started with `--loc`, export the same `TZ` (e.g. `TZ=Europe/Malta`) in other terminals before running these commands, to be safe: pebble-tool takes the time it gives the emulator from the host's timezone.
