#!/usr/bin/env python3
"""Package Rat Scout as a plugin pbw (manifestVersion 2 + the plugin script).

Until `pebble build` supports plugins (Pebble plugins preview guide, "Packaging and
sideloading": "planned for the next SDK release"), SDK 4.33.1 builds a legacy pbw: it
copies package.json's `plugin` block into appinfo.json but sets no manifestVersion and
leaves the plugin script out. This script fixes that up:

  1. checks src/plugin/index.js is up to date (node scripts/build-plugin.js --check);
  2. runs `pebble clean` + `pebble build` (the bundle step does not notice appinfo changes);
  3. opens build/<project dir name>.pbw;
  4. sets manifestVersion 2 and validates definesPermissions;
  5. adds plugin.script at its project-relative path;
  6. writes build/rat-scout-plugin.pbw.

build/<project dir name>.pbw is left as the legacy pbw, for comparison.

If the input is already manifestVersion 2 and carries the script, the pbw is copied unchanged
("official build already plugin-aware") so this script retires itself once the SDK catches up.

Run with `python3 -I scripts/pack-plugin.py` from anywhere. Options:
  --no-build   pack the existing build output without rebuilding
  --selftest   run the built-in self test on an in-memory pbw and exit

Sideload only: never publish the result to the appstore.
"""

import io
import json
import os
import re
import subprocess
import sys
import zipfile

MANIFEST_VERSION = 2
OUTPUT_NAME = 'rat-scout-plugin.pbw'

# definesPermissions rules as PebbleOS PR #2483 and pypkjs 3.0.3 (plugins/manifest.py) check them.
# The preview guide also lists `dangerous`, but neither of those accepts it.
PERMISSION_KINDS = ('read', 'write', 'exfiltrating')
PERMISSION_NAME = re.compile(r'[A-Za-z][A-Za-z0-9]*')
RESERVED_PERMISSION_NAMES = ('InvokeAction',)


class PackError(Exception):
    pass


def permission_errors(plugin):
    """Problems with the plugin's definesPermissions, as human-readable strings."""
    errors = []
    for d in plugin.get('definesPermissions', []):
        name = d.get('name', '')
        if not PERMISSION_NAME.fullmatch(str(name)):
            errors.append("permission name '%s' must be alphanumeric" % name)
        if name in RESERVED_PERMISSION_NAMES:
            errors.append("permission name '%s' is reserved" % name)
        if not str(d.get('label', '')).strip():
            errors.append("permission '%s' has no label" % name)
        if d.get('kind') not in PERMISSION_KINDS:
            errors.append("permission '%s' needs a kind: one of %s" % (name, ', '.join(PERMISSION_KINDS)))
    return errors


def pack(pbw_bytes, read_project_file):
    """Return (new pbw bytes, message). read_project_file(path) -> bytes or None."""
    with zipfile.ZipFile(io.BytesIO(pbw_bytes)) as z:
        appinfo = json.loads(z.read('appinfo.json'))
        names = z.namelist()
        entries = [(info, z.read(info)) for info in z.infolist() if info.filename != 'appinfo.json']

    plugin = appinfo.get('plugin')
    if not isinstance(plugin, dict):
        raise PackError('appinfo.json has no plugin block (was package.json changed without a clean build?)')
    script = plugin.get('script', 'plugin.js')

    if int(appinfo.get('manifestVersion', 0) or 0) >= MANIFEST_VERSION and script in names:
        return pbw_bytes, 'official build already plugin-aware: copied unchanged'

    errors = permission_errors(plugin)
    if errors:
        raise PackError('bad plugin manifest:\n  ' + '\n  '.join(errors))

    appinfo['manifestVersion'] = MANIFEST_VERSION
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('appinfo.json', json.dumps(appinfo, indent=2))
        for info, data in entries:
            z.writestr(info, data)
        if script not in names:
            data = read_project_file(script)
            if data is None:
                raise PackError("plugin.script '%s' does not exist in the project" % script)
            z.writestr(script, data)
    return out.getvalue(), 'set manifestVersion %d, added %s' % (MANIFEST_VERSION, script)


def selftest():
    def make(appinfo, extra=()):
        b = io.BytesIO()
        with zipfile.ZipFile(b, 'w') as z:
            z.writestr('appinfo.json', json.dumps(appinfo))
            z.writestr('pebble-js-app.js', 'js')
            for name, data in extra:
                z.writestr(name, data)
        return b.getvalue()

    good = {'uuid': 'x', 'plugin': {'script': 'p.js',
            'definesPermissions': [{'name': 'Glucose', 'label': 'Read', 'kind': 'read'}]}}
    files = {'p.js': b'plugin-src'}
    out, msg = pack(make(good), files.get)
    with zipfile.ZipFile(io.BytesIO(out)) as z:
        info = json.loads(z.read('appinfo.json'))
        assert info['manifestVersion'] == 2, 'manifestVersion set'
        assert z.read('p.js') == b'plugin-src', 'script added'
        assert z.read('pebble-js-app.js') == b'js', 'other entries kept'
        assert z.namelist()[0] == 'appinfo.json', 'appinfo first'
    already = make(dict(good, manifestVersion=2), [('p.js', b'x')])
    out2, msg2 = pack(already, files.get)
    assert out2 == already and 'already plugin-aware' in msg2, 'retires itself'
    for bad_def, needle in (({'name': 'Glu cose', 'label': 'L', 'kind': 'read'}, 'alphanumeric'),
                            ({'name': 'InvokeAction', 'label': 'L', 'kind': 'read'}, 'reserved'),
                            ({'name': 'G', 'label': ' ', 'kind': 'read'}, 'no label'),
                            ({'name': 'G', 'label': 'L', 'kind': 'bogus'}, 'needs a kind'),
                            ({'name': 'G', 'label': 'L', 'kind': 'dangerous'}, 'needs a kind')):
        bad = {'uuid': 'x', 'plugin': {'script': 'p.js', 'definesPermissions': [bad_def]}}
        try:
            pack(make(bad), files.get)
        except PackError as e:
            assert needle in str(e), 'error mentions %s: %s' % (needle, e)
        else:
            raise AssertionError('accepted %r' % bad_def)
    try:
        pack(make(good), {}.get)
    except PackError as e:
        assert 'does not exist' in str(e)
    else:
        raise AssertionError('accepted a missing script')
    try:
        pack(make({'uuid': 'x'}), files.get)
    except PackError as e:
        assert 'no plugin block' in str(e)
    else:
        raise AssertionError('accepted a pbw without a plugin block')
    print('selftest passed')


def main(argv):
    if '--selftest' in argv:
        selftest()
        return
    project = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    subprocess.run(['node', os.path.join('scripts', 'build-plugin.js'), '--check'], cwd=project, check=True)
    pbw_path = os.path.join(project, 'build', os.path.basename(project) + '.pbw')
    if '--no-build' not in argv:
        subprocess.run(['pebble', 'clean'], cwd=project, check=True)
        subprocess.run(['pebble', 'build'], cwd=project, check=True)
    if not os.path.isfile(pbw_path):
        raise PackError('%s not found: run pebble build' % pbw_path)

    def read_project_file(rel):
        path = os.path.join(project, rel)
        if not os.path.isfile(path):
            return None
        with open(path, 'rb') as f:
            return f.read()

    with open(pbw_path, 'rb') as f:
        data, message = pack(f.read(), read_project_file)
    out_path = os.path.join(project, 'build', OUTPUT_NAME)
    with open(out_path, 'wb') as f:
        f.write(data)
    print('%s; wrote %s (legacy pbw: %s)' % (message, os.path.relpath(out_path, project),
                                             os.path.relpath(pbw_path, project)))


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except PackError as e:
        sys.exit('pack-plugin: %s' % e)
