#!/usr/bin/env python3
"""Build Rat Scout's two pbws with the SDK and copy them to stable names.

  build/rat-scout.pbw          the watchface (`pebble build` in the project root)
  build/rat-scout-glucose.pbw  the Rat Scout Glucose plugin-only pbw (`pebble build` in plugin/,
                               projectType "plugin")

SDK 4.44 builds both natively: pbws are manifestVersion 2 by default, the plugin script and a
local configPage are bundled, and the plugin block is validated at configure time (SDK 4.44
changelog, "Changes to SDK"). `pebble build` names a pbw after its directory
(build/<checkout dir>.pbw, plugin/build/plugin.pbw); the copies give scripts/device-check.sh,
scripts/plugin-smoke.sh and scripts/run-emulator.sh fixed paths.

Steps: check plugin/plugin.js is up to date (node scripts/build-plugin.js --check);
`pebble clean` + `pebble build` in both projects; check both pbws are manifestVersion 2 (a
watchapp needs it to read plugins; preview guide, "Writing a watchface or app that uses
plugins"); copy.

Run with `python3 -I scripts/pack-plugin.py` from anywhere. Options:
  --no-build   copy the existing build outputs without rebuilding
"""

import json
import os
import shutil
import subprocess
import sys
import zipfile

PLUGIN_DIR = 'plugin'
FACE_OUTPUT = 'rat-scout.pbw'
PLUGIN_OUTPUT = 'rat-scout-glucose.pbw'


class PackError(Exception):
    pass


def manifest_version(pbw):
    """manifestVersion of a pbw's appinfo.json (0 when absent)."""
    with zipfile.ZipFile(pbw) as z:
        return int(json.loads(z.read('appinfo.json')).get('manifestVersion', 0) or 0)


def build(directory):
    subprocess.run(['pebble', 'clean'], cwd=directory, check=True)
    subprocess.run(['pebble', 'build'], cwd=directory, check=True)


def main(argv):
    project = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    plugin_dir = os.path.join(project, PLUGIN_DIR)
    subprocess.run(['node', os.path.join('scripts', 'build-plugin.js'), '--check'], cwd=project, check=True)
    if '--no-build' not in argv:
        build(project)
        build(plugin_dir)

    rel = lambda p: os.path.relpath(p, project)
    copies = (
        (os.path.join(project, 'build', os.path.basename(project) + '.pbw'), FACE_OUTPUT),
        (os.path.join(plugin_dir, 'build', os.path.basename(plugin_dir) + '.pbw'), PLUGIN_OUTPUT),
    )
    for source, name in copies:
        if not os.path.isfile(source):
            raise PackError('%s not found: run without --no-build' % rel(source))
        if manifest_version(source) < 2:
            raise PackError('%s is not manifestVersion 2: build it with SDK 4.44 or later' % rel(source))
    for source, name in copies:
        target = os.path.join(project, 'build', name)
        shutil.copyfile(source, target)
        print('%s -> %s' % (rel(source), rel(target)))


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except PackError as e:
        sys.exit('pack-plugin: %s' % e)
